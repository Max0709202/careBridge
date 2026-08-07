import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../../common/config';
import { AuthenticationError, ConflictError, ValidationError } from '../../common/errors';
import { APP_CONFIG } from '../../common/config.token';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface AccessTokenClaims {
  sub: string;
  /**
   * Nothing else goes in here. No patient ids, no permission list: those are
   * resolved server-side per request, so revoking access closes every surface
   * on the next call rather than when a token happens to expire.
   */
}

interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

/**
 * argon2id parameters.
 *
 * 19 MiB and 2 passes is the OWASP-recommended floor for argon2id. Memory cost
 * is what makes GPU cracking expensive, so it is the parameter to raise first
 * if this is ever re-tuned — not the iteration count.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Failed-login counters, in process memory.
   *
   * Redis owns this the moment there is more than one API instance — with two
   * containers the effective limit silently doubles. Called out here rather
   * than left to be discovered: at pilot scale (T3, a single instance) this is
   * correct, and beyond it, it is not.
   */
  private readonly failedLogins = new Map<
    string,
    { count: number; firstAttemptAt: number }
  >();

  /**
   * A real argon2id hash of a value nobody holds, computed once at boot.
   *
   * Verified against when the email is unknown, so a missing account and a
   * wrong password cost the same ~50ms. Hashing a literal here instead would
   * make login latency a user-enumeration oracle — and a hard-coded hash string
   * risks being subtly malformed, which `argon2.verify` would reject instantly
   * and give the timing difference straight back.
   */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.dummyHash = argon2.hash(
      randomBytes(32).toString('hex'),
      ARGON2_OPTIONS,
    );
  }

  async register(
    input: { fullName: string; email: string; password: string; acceptedTerms?: boolean },
    ctx: RequestContext = {},
  ): Promise<{ userId: string; tokens: AuthTokens }> {
    const email = normaliseEmail(input.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictError('An account already exists for that email address.');
    }

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        // Consent is recorded as an explicit act, never inferred from use of
        // the app. The copy is a placeholder pending legal review; the
        // recording mechanism is not.
        consents: input.acceptedTerms
          ? {
              create: [
                { type: 'terms', documentVersion: 'placeholder-2026-07' },
                { type: 'privacy', documentVersion: 'placeholder-2026-07' },
              ],
            }
          : undefined,
      },
    });

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const tokens = await this.issueTokens(user.id, randomUUID(), ctx);
    return { userId: user.id, tokens };
  }

  async login(
    input: { email: string; password: string },
    ctx: RequestContext = {},
  ): Promise<{ userId: string; tokens: AuthTokens }> {
    const email = normaliseEmail(input.email);
    const lockKey = `${email}|${ctx.ip ?? 'unknown'}`;

    if (this.isLockedOut(lockKey)) {
      throw new ValidationError(
        'Too many sign-in attempts. Wait a few minutes and try again.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Verify against a dummy hash when the account does not exist, so a missing
    // account and a wrong password take the same time. Skipping the hash for
    // unknown emails turns login latency into a user-enumeration oracle.
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const ok = await argon2.verify(hash, input.password).catch(() => false);

    if (!user || !ok) {
      this.recordFailedLogin(lockKey);
      await this.audit.record({
        actorUserId: user?.id ?? null,
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        correlationId: ctx.correlationId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new AuthenticationError(
        'That email address and password do not match an account.',
      );
    }

    this.failedLogins.delete(lockKey);

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const tokens = await this.issueTokens(user.id, randomUUID(), ctx);
    return { userId: user.id, tokens };
  }

  /**
   * Rotates a refresh token.
   *
   * Presenting a token that has already been rotated means two parties hold
   * tokens from one login, and only one of them is legitimate. We cannot tell
   * which, so the whole family is revoked and both are forced to sign in again.
   * An inconvenienced user beats a live session in someone else's hands.
   */
  async refresh(refreshToken: string, ctx: RequestContext = {}): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!record) throw new AuthenticationError();

    if (record.revokedAt != null) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actorUserId: record.userId,
        action: 'auth.refresh.reuse_detected',
        entityType: 'RefreshToken',
        entityId: record.id,
        correlationId: ctx.correlationId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      this.logger.warn(
        `Refresh token reuse detected; revoked family ${record.familyId}`,
      );
      throw new AuthenticationError();
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new AuthenticationError();
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(record.userId, record.familyId, ctx);
  }

  async logout(
    userId: string,
    options: { refreshToken?: string; allDevices?: boolean },
    ctx: RequestContext = {},
  ): Promise<void> {
    if (options.allDevices || !options.refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          tokenHash: hashToken(options.refreshToken),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit.record({
      actorUserId: userId,
      action: options.allDevices ? 'auth.logout_all' : 'auth.logout',
      entityType: 'User',
      entityId: userId,
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  async verifyAccessToken(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      if (!claims.sub) throw new AuthenticationError();
      return claims.sub;
    } catch {
      throw new AuthenticationError();
    }
  }

  private async issueTokens(
    userId: string,
    familyId: string,
    ctx: RequestContext,
  ): Promise<AuthTokens> {
    const expiresInSeconds = this.config.ACCESS_TOKEN_TTL_MINUTES * 60;

    const accessToken = await this.jwt.signAsync(
      { sub: userId } satisfies AccessTokenClaims,
      { expiresIn: expiresInSeconds },
    );

    // Opaque and high-entropy: a refresh token is a bearer credential with a
    // long life, so it carries no claims a client could read or a server could
    // be tricked into trusting.
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return { accessToken, refreshToken, expiresInSeconds };
  }

  private isLockedOut(key: string): boolean {
    const entry = this.failedLogins.get(key);
    if (!entry) return false;

    const windowMs = this.config.LOGIN_WINDOW_MINUTES * 60 * 1000;
    if (Date.now() - entry.firstAttemptAt > windowMs) {
      this.failedLogins.delete(key);
      return false;
    }
    return entry.count >= this.config.LOGIN_MAX_ATTEMPTS;
  }

  private recordFailedLogin(key: string): void {
    const windowMs = this.config.LOGIN_WINDOW_MINUTES * 60 * 1000;
    const entry = this.failedLogins.get(key);

    if (!entry || Date.now() - entry.firstAttemptAt > windowMs) {
      this.failedLogins.set(key, { count: 1, firstAttemptAt: Date.now() });
      return;
    }
    entry.count += 1;
  }
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Refresh tokens are stored only as a digest.
 *
 * SHA-256 rather than argon2 on purpose: these are 48 random bytes, not a
 * human-chosen secret, so there is no dictionary to slow an attacker down
 * against — and this runs on every token refresh, where argon2's cost would buy
 * nothing and be paid constantly.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
