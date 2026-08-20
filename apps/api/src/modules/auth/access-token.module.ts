import { Injectable, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';

import { appConfig } from '../../common/config';
import { AuthenticationError } from '../../common/errors';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** What a verified access token resolves to. */
export interface AuthenticatedCaller {
  userId: string;
  /**
   * The refresh-token family this access token was minted under, so
   * `/auth/sessions` can mark one row "this device". Opaque, and grants
   * nothing on its own.
   */
  familyId: string;
}

interface AccessTokenClaims {
  sub?: string;
  fam?: string;
  /** `tokenVersion` at issue. A global sign-out increments it. */
  v?: number;
}

/**
 * Verifying an access token, in one place both `AuthModule` and the tracking
 * gateway can reach.
 *
 * Extracted for a structural reason rather than a stylistic one.
 * `AuthModule` imports `CareModule`, and `CareModule` needs the tracking
 * module so a ride transition can close a live map — so a tracking module that
 * imported `AuthModule` would close a cycle. The available answers were
 * `forwardRef`, or a second copy of this check inside the gateway.
 *
 * Both were worse. `forwardRef` makes the cycle work without removing it, and
 * a second copy would be a second implementation of the **`tokenVersion`
 * check** — the line that makes "sign out everywhere" real. A signed-out
 * session that could still open a WebSocket and watch a patient move is
 * exactly the failure this system's session model exists to prevent, and it
 * would be invisible: the HTTP surface would refuse them correctly while the
 * socket kept streaming.
 */
@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async verify(token: string): Promise<AuthenticatedCaller> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new AuthenticationError();
    }

    if (!claims.sub) throw new AuthenticationError();

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { tokenVersion: true },
    });

    // The signature being valid is not enough. `tokenVersion` is what makes a
    // global sign-out take effect before the token's own expiry, and a
    // deleted user's still-valid token authenticate nobody.
    if (!user || user.tokenVersion !== claims.v) throw new AuthenticationError();

    return { userId: claims.sub, familyId: claims.fam ?? '' };
  }
}

/**
 * Carries the JWT configuration as well as the verifier, so that anything
 * importing this module gets a `JwtService` configured the same way — one
 * secret, one algorithm, one issuer.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const config = appConfig();
        return {
          secret: config.JWT_SECRET,
          signOptions: { algorithm: 'HS256', issuer: 'carebridge' },
          verifyOptions: { algorithms: ['HS256'], issuer: 'carebridge' },
        };
      },
    }),
  ],
  providers: [AccessTokenVerifier],
  exports: [AccessTokenVerifier, JwtModule],
})
export class AccessTokenModule {}
