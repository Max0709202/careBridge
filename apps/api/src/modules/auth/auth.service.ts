import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../../common/config';
import {
  AuthenticationError,
  ConflictError,
  RateLimitError,
  ValidationError,
} from '../../common/errors';
import { APP_CONFIG } from '../../common/config.token';
import { MAIL, type MailPort } from '../../infrastructure/mail/mail.port';
import {
  RATE_LIMITER,
  type RateLimiterPort,
} from '../../infrastructure/rate-limit/rate-limit.port';
import { CredentialTokensService } from './credential-tokens.service';
import { MfaService } from './mfa.service';
import { SessionsService } from './sessions.service';
import { hashToken } from './crypto';
import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from './mail-templates';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface AccessTokenClaims {
  sub: string;
  /**
   * Token version. Bumped by "sign out everywhere" and by a password change,
   * so raising it invalidates every access token already minted without
   * waiting for each to expire. Checked on every request — the one extra
   * lookup is what makes revocation actually immediate rather than
   * immediate-within-fifteen-minutes.
   */
  v: number;
  /**
   * The refresh-token family this access token belongs to, so `/auth/sessions`
   * can mark one row "this device". It is an opaque id and grants nothing on
   * its own.
   */
  fam: string;
  /**
   * Nothing else goes in here. No patient ids, no permission list: those are
   * resolved server-side per request, so revoking access closes every surface
   * on the next call rather than when a token happens to expire.
   */
}

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface AuthenticatedCaller {
  userId: string;
  familyId: string;
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
    private readonly credentials: CredentialTokensService,
    private readonly mfa: MfaService,
    @Inject(MAIL) private readonly mail: MailPort,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiterPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.dummyHash = argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
  }

  // ─── registration and sign-in ─────────────────────────────────────────────

  async register(
    input: {
      fullName: string;
      email: string;
      password: string;
      acceptedTerms?: boolean;
      timeZone?: string;
    },
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
        ...(input.timeZone ? { timeZone: input.timeZone } : {}),
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

    await this.sendVerificationEmail(user.id, email, ctx);

    const tokens = await this.issueTokens(user.id, randomUUID(), ctx);
    return { userId: user.id, tokens };
  }

  async login(
    input: { email: string; password: string; mfaCode?: string },
    ctx: RequestContext = {},
  ): Promise<{ userId: string; tokens: AuthTokens }> {
    const email = normaliseEmail(input.email);

    // Keyed on the pair, not on either half. Per-email alone lets one careless
    // person on a shared office address lock out everybody behind it; per-IP
    // alone is already covered by the route's own limit, which counts every
    // attempt rather than only the failures.
    //
    // Only *failed* attempts land here, which is why it is enforced in the
    // service and not in the guard: signing in correctly ten times in a row is
    // a person with several devices, not an attack.
    const lockKey = `signIn:credentials:${email}|${ctx.ip ?? 'unknown'}`;
    await this.assertNotLockedOut(lockKey);

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Verify against a dummy hash when the account does not exist, so a missing
    // account and a wrong password take the same time. Skipping the hash for
    // unknown emails turns login latency into a user-enumeration oracle.
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const ok = await argon2.verify(hash, input.password).catch(() => false);

    if (!user || !ok) {
      await this.recordFailedLogin(lockKey);
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

    // The second factor is checked only after the password, so a wrong
    // password and a missing code are not distinguishable by which error
    // arrives first — and so an attacker without the password never learns
    // whether an account has MFA at all.
    const mfa = await this.mfa.requireIfEnrolled(user.id, input.mfaCode);
    if (!mfa.satisfied) {
      await this.recordFailedLogin(lockKey);
      await this.audit.record({
        actorUserId: user.id,
        action: input.mfaCode ? 'auth.mfa.failed' : 'auth.mfa.required',
        entityType: 'User',
        entityId: user.id,
        correlationId: ctx.correlationId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new ValidationError(
        input.mfaCode
          ? 'That authentication code is not right.'
          : 'Enter the code from your authenticator app.',
        'mfaCode',
      );
    }

    // Signed in: forget the failures, so getting your own password wrong twice
    // and then right does not leave a counter primed against you.
    await this.rateLimiter.reset(lockKey);

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
        data: { revokedAt: new Date(), revokedReason: 'reuse_detected' },
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
      data: { revokedAt: new Date(), revokedReason: 'rotated' },
    });

    // The device label travels with the family, so a session keeps one
    // identity for its whole life instead of appearing to be a new device
    // every fifteen minutes.
    return this.issueTokens(record.userId, record.familyId, ctx, record.deviceLabel);
  }

  async logout(
    userId: string,
    options: { refreshToken?: string; allDevices?: boolean },
    ctx: RequestContext = {},
  ): Promise<void> {
    if (options.allDevices || !options.refreshToken) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'logout_all' },
        }),
        // Revoking refresh tokens alone would leave every already-issued
        // access token working until it expired. Bumping the version is what
        // makes "sign out everywhere" mean it.
        this.prisma.user.update({
          where: { id: userId },
          data: { tokenVersion: { increment: 1 } },
        }),
      ]);
    } else {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          tokenHash: hashToken(options.refreshToken),
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedReason: 'logout' },
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

  // ─── email verification ───────────────────────────────────────────────────

  /**
   * Issues a verification token and emails it.
   *
   * Deliberately not awaited on the caller's critical path when it is a side
   * effect of registration — but it *is* awaited here, because a mail failure
   * during registration is something the user should be able to retry rather
   * than discover later. The queue handles the retry story for notifications;
   * this one message is worth the extra hundred milliseconds.
   */
  private async sendVerificationEmail(
    userId: string,
    email: string,
    ctx: RequestContext,
  ): Promise<void> {
    const issued = await this.credentials.issue(
      userId,
      email,
      'emailVerification',
      ctx,
    );

    await this.mail
      .send(
        verificationEmail(
          {
            appUrl: this.config.PUBLIC_APP_URL,
            correlationId: ctx.correlationId ?? undefined,
          },
          {
            to: email,
            token: issued.token,
            expiresInHours: this.config.EMAIL_VERIFICATION_TTL_HOURS,
          },
        ),
      )
      .catch((error: unknown) => {
        // A failed send must not fail a registration that has already written
        // a user row. The token is valid; "resend" is one tap away.
        this.logger.error(
          `Could not send a verification email: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
  }

  async verifyEmail(token: string, ctx: RequestContext = {}): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { userId, email } = await this.credentials.consume(
        token,
        'emailVerification',
        tx,
      );

      const user = await tx.user.findUnique({ where: { id: userId } });

      // The address must still be the one the token was issued for. Without
      // this, changing the account email after requesting verification would
      // mark the *new* address verified on the strength of a link sent to the
      // old one.
      if (!user || user.email !== email) {
        throw new ValidationError('That link is no longer valid. Request a new one.');
      }

      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'auth.email.verified',
          entityType: 'User',
          entityId: userId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /**
   * Resend. Returns nothing either way.
   *
   * An already-verified account and an unverified one are indistinguishable to
   * the caller, because the difference is a fact about a person's account that
   * an unauthenticated request should not be able to read.
   */
  async resendVerification(email: string, ctx: RequestContext = {}): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(email) },
    });
    if (!user || user.emailVerifiedAt != null) return;

    await this.sendVerificationEmail(user.id, user.email, ctx);
  }

  // ─── password reset ───────────────────────────────────────────────────────

  /**
   * Always returns as though it worked.
   *
   * The response to "reset my password" cannot depend on whether the address
   * has an account, or the endpoint becomes a way to enumerate the customer
   * list — and for this product, the customer list is a list of people with a
   * vulnerable relative.
   */
  async requestPasswordReset(email: string, ctx: RequestContext = {}): Promise<void> {
    const normalised = normaliseEmail(email);
    const user = await this.prisma.user.findUnique({ where: { email: normalised } });
    if (!user) return;

    const issued = await this.credentials.issue(
      user.id,
      normalised,
      'passwordReset',
      ctx,
    );

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password.reset_requested',
      entityType: 'User',
      entityId: user.id,
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await this.mail
      .send(
        passwordResetEmail(
          {
            appUrl: this.config.PUBLIC_APP_URL,
            correlationId: ctx.correlationId ?? undefined,
          },
          {
            to: normalised,
            token: issued.token,
            expiresInMinutes: this.config.PASSWORD_RESET_TTL_MINUTES,
          },
        ),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Could not send a password reset email: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
  }

  /**
   * Completes a reset: sets the password, revokes every session, and tells the
   * account holder it happened.
   *
   * All three matter together. A reset that leaves existing sessions alive
   * hands an attacker who already has one a permanent foothold that changing
   * the password does not dislodge; a reset that happens silently is an
   * account takeover the owner never learns about.
   */
  async confirmPasswordReset(
    token: string,
    newPassword: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);

    const email = await this.prisma.$transaction(async (tx) => {
      const consumed = await this.credentials.consume(token, 'passwordReset', tx);

      const user = await tx.user.findUnique({ where: { id: consumed.userId } });
      if (!user || user.email !== consumed.email) {
        throw new ValidationError('That link is no longer valid. Request a new one.');
      }

      await tx.user.update({
        where: { id: consumed.userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
          // Completing a reset proves control of the mailbox, which is the
          // same proof email verification asks for.
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId: consumed.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_reset' },
      });

      await this.audit.record(
        {
          actorUserId: consumed.userId,
          action: 'auth.password.reset_completed',
          entityType: 'User',
          entityId: consumed.userId,
          changedFields: ['passwordHash'],
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return user.email;
    });

    await this.mail
      .send(
        passwordChangedEmail(
          {
            appUrl: this.config.PUBLIC_APP_URL,
            correlationId: ctx.correlationId ?? undefined,
          },
          { to: email },
        ),
      )
      .catch(() => undefined);
  }

  /** Changing a password while signed in. Same consequences as a reset. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AuthenticationError();

    const ok = await argon2
      .verify(user.passwordHash, currentPassword)
      .catch(() => false);
    if (!ok) {
      throw new ValidationError(
        'That is not your current password.',
        'currentPassword',
      );
    }

    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      });
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'auth.password.changed',
          entityType: 'User',
          entityId: userId,
          changedFields: ['passwordHash'],
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });

    await this.mail
      .send(
        passwordChangedEmail(
          {
            appUrl: this.config.PUBLIC_APP_URL,
            correlationId: ctx.correlationId ?? undefined,
          },
          { to: user.email },
        ),
      )
      .catch(() => undefined);
  }

  // ─── token plumbing ───────────────────────────────────────────────────────

  /**
   * Verifies an access token and confirms it has not been revoked wholesale.
   *
   * The `tokenVersion` lookup is one indexed read per request, and it is the
   * price of "sign out everywhere" and "password change" taking effect now
   * rather than in up to fifteen minutes. On a product where the thing being
   * protected is a vulnerable person's home address and live position, that is
   * the right trade.
   */
  async verifyAccessToken(token: string): Promise<AuthenticatedCaller> {
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

    if (!user || user.tokenVersion !== claims.v) throw new AuthenticationError();

    return { userId: claims.sub, familyId: claims.fam ?? '' };
  }

  private async issueTokens(
    userId: string,
    familyId: string,
    ctx: RequestContext,
    deviceLabel?: string | null,
  ): Promise<AuthTokens> {
    const expiresInSeconds = this.config.ACCESS_TOKEN_TTL_MINUTES * 60;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenVersion: true },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: userId, v: user.tokenVersion, fam: familyId } satisfies AccessTokenClaims,
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
        ip: ctx.ip ?? null,
        deviceLabel: deviceLabel ?? SessionsService.describeDevice(ctx.userAgent),
        lastUsedAt: new Date(),
      },
    });

    return { accessToken, refreshToken, expiresInSeconds };
  }

  private get loginPolicy(): { limit: number; windowMs: number } {
    return {
      limit: this.config.LOGIN_MAX_ATTEMPTS,
      windowMs: this.config.LOGIN_WINDOW_MINUTES * 60 * 1000,
    };
  }

  /**
   * Refuse if this email+IP pair has already spent its failures.
   *
   * `peek`, not `consume`: only failures count here, so the check itself must
   * not. Counting every attempt would lock out anyone who signs in more often
   * than the limit — which, at eight attempts per fifteen minutes, is an
   * ordinary person with a phone and a laptop.
   */
  private async assertNotLockedOut(key: string): Promise<void> {
    const decision = await this.rateLimiter.peek(key, this.loginPolicy);
    if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);
  }

  private async recordFailedLogin(key: string): Promise<void> {
    await this.rateLimiter.consume(key, this.loginPolicy);
  }
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
