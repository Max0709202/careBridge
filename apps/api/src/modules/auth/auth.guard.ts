import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { AuthenticationError } from '../../common/errors';

export const IS_PUBLIC = 'carebridge:public';

/** Opts a route out of authentication. Everything else is protected. */
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC, true);

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
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

    request.userId = await this.auth.verifyAccessToken(header.slice(7).trim());
    return true;
  }
}
