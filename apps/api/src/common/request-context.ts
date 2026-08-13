import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AuthenticationError } from './errors';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
}

/** The authenticated user id, guaranteed present because AuthGuard ran first. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.userId) throw new AuthenticationError();
    return request.userId;
  },
);

/** The refresh-token family of the caller's session, or null. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.sessionFamilyId ?? null;
  },
);

/**
 * The forensic trio every audit row carries. Collected in one place so a
 * handler cannot accidentally record an action without them.
 */
export const Ctx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return {
      ip: request.ip ?? null,
      userAgent: request.header('user-agent') ?? null,
      correlationId: request.correlationId ?? null,
    };
  },
);
