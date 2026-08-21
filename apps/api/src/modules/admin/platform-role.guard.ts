import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthenticationError, AuthorizationError } from '../../common/errors';

export type PlatformRole = 'none' | 'support' | 'admin';

const PLATFORM_ROLE = 'platformRole';

/** The minimum standing required. `admin` implies `support`. */
export const RequiresPlatform = (role: 'support' | 'admin'): MethodDecorator =>
  SetMetadata(PLATFORM_ROLE, role);

const RANK: Record<PlatformRole, number> = { none: 0, support: 1, admin: 2 };

/**
 * Whether the caller works for CareBridge, and whether they have a second
 * factor.
 *
 * Two checks, and the second is the one worth explaining. FOUNDATION §5 says
 * MFA enforcement "for staff and admin roles arrives with those roles" — this
 * is where those roles arrive, so this is where it is enforced. **A platform
 * account without a confirmed second factor cannot use the admin surface at
 * all.** Not warned, not nagged: refused.
 *
 * The reasoning is about what these endpoints reach. An operator's owner can
 * do a great deal of damage to their own company. A platform administrator can
 * read the audit log across every organisation and move money out of the
 * business, and the account that can do that is the single most valuable
 * password in the system to guess.
 *
 * Read per request rather than carried in the token, deliberately. Revoking
 * somebody's standing — or their second factor — has to take effect now, not
 * when their access token expires.
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<'support' | 'admin' | undefined>(
      PLATFORM_ROLE,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.userId;
    if (!userId) throw new AuthenticationError();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { platformRole: true, mfaEnrolment: { select: { confirmedAt: true } } },
    });

    // The same 404 every other refused lookup returns. An ordinary user
    // probing /admin must not be able to tell the difference between "this
    // endpoint does not exist" and "you are not staff" — the second answer
    // maps out the administration surface for them.
    if (!user || RANK[user.platformRole] < RANK[required]) {
      throw new AuthorizationError();
    }

    if (!user.mfaEnrolment?.confirmedAt) {
      throw new AuthorizationError();
    }

    return true;
  }
}
