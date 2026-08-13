import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors';
import { base32Encode, totpUri, verifyTotp } from '../../domain/totp';
import {
  hashToken,
  mintRecoveryCodes,
  normaliseRecoveryCode,
  openSecret,
  sealSecret,
} from './crypto';

export interface MfaEnrolment {
  /** Rendered as a QR code by the client. Returned once, never re-readable. */
  otpauthUri: string;
  /** For manual entry when a camera is not available. */
  secretBase32: string;
  recoveryCodes: string[];
}

export interface MfaStatus {
  enrolled: boolean;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
}

/**
 * TOTP multi-factor authentication.
 *
 * Scaffolding in the sense FOUNDATION §5 means it: the storage, the enrol →
 * confirm round trip, the recovery codes and the verification are all real and
 * tested. What is not here is *enforcement*, because enforcement is defined
 * per role ("staff and admin"), and those roles arrive with the organisation
 * model. `requireIfEnrolled` is the seam the login flow already calls, so
 * turning enforcement on later is a policy change rather than a redesign.
 *
 * Two decisions are load-bearing:
 *
 *   - **Enrolment is not complete until a code is verified.** Marking MFA
 *     active the moment the QR code is displayed locks out everyone whose
 *     authenticator app failed to scan it — with no second factor to recover
 *     with, by definition.
 *   - **The secret is encrypted at rest** under a key this database does not
 *     contain. Without that, a dump is a working set of second factors, and
 *     the user believes they have protection they do not.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async status(userId: string): Promise<MfaStatus> {
    const record = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!record) {
      return { enrolled: false, confirmedAt: null, recoveryCodesRemaining: 0 };
    }
    return {
      enrolled: record.confirmedAt != null,
      confirmedAt: record.confirmedAt?.toISOString() ?? null,
      recoveryCodesRemaining: record.recoveryCodeHashes.length,
    };
  }

  /**
   * Begins enrolment: mints a secret, seals it, and returns what the client
   * needs to show. Replaces any unconfirmed attempt; refuses to silently
   * replace a confirmed one, because that would let anyone with a live session
   * swap out the second factor without proving they hold the current one.
   */
  async beginEnrolment(
    userId: string,
    email: string,
    ctx: AuditContext = {},
  ): Promise<MfaEnrolment> {
    const key = this.requireKey();

    const existing = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (existing?.confirmedAt != null) {
      throw new ConflictError(
        'Two-factor authentication is already on for this account. Turn it off first if you want to set up a new device.',
      );
    }

    // 20 bytes: the RFC 4226 recommendation, and what every authenticator app
    // expects from a SHA-1 TOTP secret.
    const secret = randomBytes(20);
    const sealed = sealSecret(secret, key);
    const recoveryCodes = mintRecoveryCodes();

    await this.prisma.userMfa.upsert({
      where: { userId },
      create: {
        userId,
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        secretAuthTag: sealed.authTag,
        recoveryCodeHashes: recoveryCodes.map(hashToken),
      },
      update: {
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        secretAuthTag: sealed.authTag,
        recoveryCodeHashes: recoveryCodes.map(hashToken),
        confirmedAt: null,
      },
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'auth.mfa.enrolment_started',
      entityType: 'UserMfa',
      entityId: userId,
      ...ctx,
    });

    return {
      otpauthUri: totpUri({ issuer: 'CareBridge', accountName: email, secret }),
      secretBase32: base32Encode(secret),
      recoveryCodes,
    };
  }

  /** Completes enrolment. One correct code is the proof the app was set up. */
  async confirmEnrolment(
    userId: string,
    code: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    const key = this.requireKey();
    const record = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!record) throw new NotFoundError();
    if (record.confirmedAt != null) return;

    const secret = openSecret(
      {
        ciphertext: record.secretCiphertext,
        iv: record.secretIv,
        authTag: record.secretAuthTag,
      },
      key,
    );

    if (!verifyTotp(secret, code, Date.now())) {
      throw new ValidationError('That code is not right. Try the current one.');
    }

    await this.prisma.userMfa.update({
      where: { userId },
      data: { confirmedAt: new Date() },
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'auth.mfa.enabled',
      entityType: 'UserMfa',
      entityId: userId,
      ...ctx,
    });
  }

  /**
   * Verifies a code at sign-in, accepting a recovery code as an alternative.
   *
   * A used recovery code is removed in the same call, which is what makes it
   * single-use. Returning `false` rather than throwing keeps the caller free
   * to decide what a failure means — at login it is an authentication error,
   * during a step-up it is a retry.
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const key = this.config.mfaSecretKey;
    if (!key) return false;

    const record = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!record || record.confirmedAt == null) return false;

    const secret = openSecret(
      {
        ciphertext: record.secretCiphertext,
        iv: record.secretIv,
        authTag: record.secretAuthTag,
      },
      key,
    );

    if (verifyTotp(secret, code, Date.now())) return true;

    const digest = hashToken(normaliseRecoveryCode(code));
    if (!record.recoveryCodeHashes.includes(digest)) return false;

    await this.prisma.userMfa.update({
      where: { userId },
      data: {
        recoveryCodeHashes: record.recoveryCodeHashes.filter((h) => h !== digest),
      },
    });
    return true;
  }

  /**
   * The seam enforcement will hang off.
   *
   * Today: if the account has confirmed MFA, a code is required. When staff and
   * admin roles exist, this is where "required for those roles regardless of
   * enrolment" goes — one place, not scattered through the login handler.
   */
  async requireIfEnrolled(
    userId: string,
    code: string | undefined,
  ): Promise<{ satisfied: boolean; required: boolean }> {
    const record = await this.prisma.userMfa.findUnique({
      where: { userId },
      select: { confirmedAt: true },
    });

    const required = record?.confirmedAt != null;
    if (!required) return { satisfied: true, required: false };
    if (!code) return { satisfied: false, required: true };

    return { satisfied: await this.verify(userId, code), required: true };
  }

  async disable(userId: string, ctx: AuditContext = {}): Promise<void> {
    await this.prisma.userMfa.deleteMany({ where: { userId } });
    await this.audit.record({
      actorUserId: userId,
      action: 'auth.mfa.disabled',
      entityType: 'UserMfa',
      entityId: userId,
      ...ctx,
    });
  }

  /**
   * Refuses enrolment rather than storing a secret in the clear.
   *
   * A user who is told "two-factor is on" while the secret sits unencrypted in
   * a table has been given a false belief about their own security, which is
   * worse than being told the feature is unavailable.
   */
  private requireKey(): Buffer {
    if (!this.config.mfaSecretKey) {
      throw new ConflictError(
        'Two-factor authentication is not available on this deployment: MFA_SECRET_KEY is not configured.',
      );
    }
    return this.config.mfaSecretKey;
  }
}

interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}
