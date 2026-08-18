import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { firstValueFrom, from, type Observable } from 'rxjs';

import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ConflictError, ValidationError } from './errors';

const IDEMPOTENT_KEY = 'carebridge:idempotent';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Long enough to be unguessable, short enough not to be a payload. */
const MAX_KEY_LENGTH = 200;
const MIN_KEY_LENGTH = 8;

/**
 * This route must not be performed twice for one `Idempotency-Key`.
 *
 * Put it on anything that creates something. A retry after a dropped
 * connection is indistinguishable from a second intention at the HTTP level,
 * and for "request transport" the difference is a second car.
 */
export const Idempotent = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'Opaque, client-generated, 8–200 characters. Repeating a request with the same key returns the first response rather than performing it again. Same key with a different body is refused. Honoured for 24 hours.',
    }),
  );

/**
 * Replay protection for the endpoints that create things.
 *
 * The shape is the one every payment API converged on, for the same reason:
 *
 *   1. Claim the key by inserting a row. The unique constraint on
 *      (userId, key) makes the claim atomic, so two concurrent retries race
 *      and exactly one proceeds.
 *   2. Run the handler, then store its status and body against the claim.
 *   3. A later request with the same key returns the stored response without
 *      touching the database again.
 *
 * Three cases are refused rather than answered:
 *
 *   - Same key, different body. That is two intentions sharing a key, and
 *     answering with the first one's result would silently discard the second.
 *   - Same key, still in flight. The first request has not finished; the right
 *     answer is "wait", not "do it again".
 *   - A key that is absurdly short or long. It becomes a database key, and a
 *     one-character key from a client that generates them badly turns every
 *     user's first request into everyone else's replay.
 *
 * Without a key the request proceeds normally. Requiring one would break every
 * client that has not been updated yet, and a 400 on "request transport"
 * because a header was missing is a worse failure than the one being prevented.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  /**
   * How long a key is remembered. A retry happens within seconds; a day is
   * generous for a client that queued the request while offline. The retention
   * sweep removes them afterwards.
   */
  static readonly RETENTION_HOURS = 24;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const idempotent = this.reflector.getAllAndOverride<boolean | undefined>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!idempotent) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const key = readKey(request);
    if (!key) return next.handle();

    return from(this.handle(context, next, request, key));
  }

  private async handle(
    context: ExecutionContext,
    next: CallHandler,
    request: Request,
    key: string,
  ): Promise<unknown> {
    const userId = request.userId;
    // Unauthenticated routes are not idempotent-decorated today; if one ever
    // is, keying it by user is impossible and pretending otherwise would make
    // one caller's key global.
    if (!userId) return firstValueFrom(next.handle());

    // The matched route pattern when Express exposes one (`/patients/:id/…`),
    // so two calls that differ only in a path parameter are still one
    // endpoint; the concrete path otherwise. Express types this as `any`.
    const route = (request as { route?: { path?: unknown } }).route;
    const pattern = typeof route?.path === 'string' ? route.path : request.path;
    const endpoint = `${request.method} ${pattern}`;
    const requestHash = hashBody(request.body);

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (existing) {
      if (existing.endpoint !== endpoint || existing.requestHash !== requestHash) {
        throw new ValidationError(
          'That idempotency key was already used for a different request.',
          'Idempotency-Key',
        );
      }

      if (existing.completedAt == null) {
        throw new ConflictError(
          'A request with that idempotency key is still in progress.',
        );
      }

      const response = context.switchToHttp().getResponse<Response>();
      response.status(existing.responseStatus ?? 200);
      // A replay is answered from the record, and says so — a client that
      // retried has a way to tell that its first attempt did land.
      response.setHeader('Idempotent-Replay', 'true');
      return existing.responseBody;
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: { userId, key, endpoint, requestHash },
      });
    } catch {
      // Lost the race to insert: another request holds the claim. Whether it
      // has finished by now is not worth a second lookup — "try again" is the
      // right answer either way, and it is a retry that is asking.
      throw new ConflictError(
        'A request with that idempotency key is still in progress.',
      );
    }

    // Only a success is recorded as complete. A failed request must stay
    // retryable with the same key: a client that hit a validation error, fixed
    // it, and retried would otherwise be locked out of its own operation for a
    // day — and a request that failed did not happen, so there is nothing to
    // protect against repeating.
    let result: unknown;
    try {
      result = await firstValueFrom(next.handle());
    } catch (error) {
      await this.releaseClaim(userId, key);
      throw error;
    }

    const status = context.switchToHttp().getResponse<Response>().statusCode;
    if (status < 200 || status >= 300) {
      await this.releaseClaim(userId, key);
      return result;
    }

    await this.prisma.idempotencyRecord.update({
      where: { userId_key: { userId, key } },
      data: {
        responseStatus: status,
        responseBody: (result ?? null) as never,
        completedAt: new Date(),
      },
    });

    return result;
  }

  /** Best-effort: an orphaned claim expires with the retention sweep anyway. */
  private async releaseClaim(userId: string, key: string): Promise<void> {
    await this.prisma.idempotencyRecord
      .delete({ where: { userId_key: { userId, key } } })
      .catch(() => undefined);
  }
}

function readKey(request: Request): string | null {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) {
    throw new ValidationError(
      `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.`,
      'Idempotency-Key',
    );
  }

  return trimmed;
}

/**
 * The body, hashed rather than stored.
 *
 * These bodies carry addresses, appointment times and patient ids. Keeping a
 * copy for a day to compare against would be a second store of exactly the
 * data the rest of the system is careful about; a hash answers the only
 * question being asked — "is this the same request?".
 */
function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

/** Key order in JSON is not guaranteed across clients, so it is normalised. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(',')}}`;
}
