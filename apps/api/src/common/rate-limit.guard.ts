import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { APP_CONFIG } from './config.token';
import type { AppConfig } from './config';
import { RateLimitError } from './errors';
import {
  RATE_LIMITER,
  type RateLimitPolicy,
  type RateLimiterPort,
} from '../infrastructure/rate-limit/rate-limit.port';

/**
 * Which limit a route is under. Named rather than expressed as numbers at the
 * call site: a decorator is evaluated when the class is defined, long before
 * configuration is resolved, so the route declares *what kind of abuse it is
 * exposed to* and the guard looks up what that currently costs.
 */
export type RateLimitPolicyName = 'signIn' | 'emailDispatch' | 'tokenGuess';

const RATE_LIMIT_KEY = 'carebridge:rate-limit';

/**
 * Rate-limit this route. See config.ts for what each policy protects and why
 * the numbers are what they are.
 *
 * Documents the 429 at the same time, so the generated contract describes the
 * response a client will actually meet. A limit that only exists in the code
 * is one every client discovers in production.
 */
export const RateLimit = (policy: RateLimitPolicyName): MethodDecorator =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_KEY, policy),
    ApiTooManyRequestsResponse({
      description:
        'Too many attempts. `Retry-After` carries the wait in seconds. The body says nothing about which limit was reached — that would confirm whether an address has an account.',
    }),
  );

/**
 * Counts attempts on the endpoints an unauthenticated caller can reach, and
 * refuses them past the configured limit.
 *
 * Two dimensions, and both matter:
 *
 *   IP     — one host cannot work through a list of addresses.
 *   email  — many hosts cannot work through one address.
 *
 * Either exceeding its limit refuses the request. The counter is keyed by
 * policy name too, so exhausting the password-reset allowance does not also
 * lock a person out of signing in.
 *
 * The email is read from the request body, which is attacker-controlled — it
 * is lower-cased and length-capped before it becomes part of a Redis key, so
 * it cannot be used to write unbounded keys.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiterPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.getAllAndOverride<RateLimitPolicyName | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!name) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const policy = this.policyFor(name);

    const ip = request.ip ?? 'unknown-ip';
    const keys = [`${name}:ip:${ip}`];

    const email = readEmail(request.body);
    if (email) keys.push(`${name}:email:${email}`);

    // Every key is consumed, not just up to the first refusal: a caller who
    // has exhausted one dimension must still count against the other, or the
    // cheap key becomes a way to avoid the expensive one.
    const decisions = await Promise.all(
      keys.map((key) => this.limiter.consume(key, policy)),
    );

    const refused = decisions.filter((decision) => !decision.allowed);
    if (refused.length === 0) return true;

    throw new RateLimitError(
      Math.max(...refused.map((decision) => decision.retryAfterSeconds)),
    );
  }

  private policyFor(name: RateLimitPolicyName): RateLimitPolicy {
    const minutes = (value: number): number => value * 60 * 1000;

    switch (name) {
      case 'signIn':
        return {
          limit: this.config.SIGN_IN_IP_MAX_ATTEMPTS,
          windowMs: minutes(this.config.LOGIN_WINDOW_MINUTES),
        };
      case 'emailDispatch':
        return {
          limit: this.config.EMAIL_DISPATCH_MAX_ATTEMPTS,
          windowMs: minutes(this.config.EMAIL_DISPATCH_WINDOW_MINUTES),
        };
      case 'tokenGuess':
        return {
          limit: this.config.TOKEN_GUESS_MAX_ATTEMPTS,
          windowMs: minutes(this.config.TOKEN_GUESS_WINDOW_MINUTES),
        };
    }
  }
}

/** At most one address, normalised, and short enough to be a safe key. */
function readEmail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('email' in body)) return null;

  // `'email' in body` has already narrowed it; the value is still unknown.
  const value: unknown = body.email;
  if (typeof value !== 'string') return null;

  const normalised = value.trim().toLowerCase();
  if (normalised.length === 0 || normalised.length > 254) return null;

  return normalised;
}
