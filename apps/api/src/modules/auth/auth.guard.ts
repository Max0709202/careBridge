import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { AuthenticationError } from '../../common/errors';
import { setCurrentUserId } from '../../common/logging/correlation-store';

export const IS_PUBLIC = 'carebridge:public';

/** Opts a route out of authentication. Everything else is protected. */
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC, true);

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    /**
     * The refresh-token family the access token was minted under, so
     * `/auth/sessions` can mark one row "this device". Opaque, and grants
     * nothing on its own.
     */
    sessionFamilyId?: string;
  }
}

/**
 * Registered globally, so authentication is the default and a route has to
 * *ask* to be public. The reverse — remembering `@UseGuards` on each new
 * controller — is the single most common way an endpoint ships unprotected.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization');

    if (!header?.startsWith('Bearer ')) {
      throw new AuthenticationError();
    }

    const caller = await this.auth.verifyAccessToken(header.slice(7).trim());
    request.userId = caller.userId;
    request.sessionFamilyId = caller.familyId;

    // Every log line for the rest of this request now names the actor — by id
    // only, never by email, which is on the redaction denylist anyway.
    setCurrentUserId(caller.userId);
    return true;
  }
}
