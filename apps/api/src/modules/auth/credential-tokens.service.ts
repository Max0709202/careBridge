import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CredentialTokenType, Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { ValidationError } from '../../common/errors';
import { hashToken, mintToken } from './crypto';

export interface IssuedToken {
  /** The plaintext, which exists only for the length of one request. */
  token: string;
  expiresAt: Date;
}

/**
 * Single-use, expiring, address-bound secrets: email verification and password
 * reset.
 *
 * They share an implementation because they are the same object with a
 * different purpose, and because the security properties they need are
 * identical — get one of them wrong in one place and it is wrong in both.
 */
@Injectable()
export class CredentialTokensService {
  private readonly logger = new Logger(CredentialTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Issues a token, invalidating any outstanding one of the same type.
   *
   * Invalidating the previous token matters: without it, a user who clicks
   * "resend" three times leaves three live reset links in three copies of an
   * email, each one a credential, all valid until they expire. Only the newest
   * should work.
   */
  async issue(
    userId: string,
    email: string,
    type: CredentialTokenType,
    ctx: { ip?: string | null } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<IssuedToken> {
    const db = tx ?? this.prisma;
    const token = mintToken();
    const expiresAt = new Date(Date.now() + this.ttlMs(type));

    await db.credentialToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });

    await db.credentialToken.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(token),
        email: email.trim().toLowerCase(),
        expiresAt,
        ip: ctx.ip ?? null,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Consumes a token, or throws.
   *
   * The consume-and-check happens in one transaction with the caller's work,
   * so a token cannot be spent twice by two requests racing. Checking validity
   * and then marking it used in a second statement is the classic version of
   * this bug, and it is reachable by double-clicking a link.
   *
   * Every failure returns the same message. "Expired", "already used" and
   * "never existed" are one outcome to the caller, because distinguishing them
   * tells someone holding a guessed token which guesses are close.
   */
  async consume(
    token: string,
    type: CredentialTokenType,
    tx: Prisma.TransactionClient,
  ): Promise<{ userId: string; email: string }> {
    const record = await tx.credentialToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    const invalid = new ValidationError(
      'That link is no longer valid. Request a new one.',
    );

    if (!record || record.type !== type) throw invalid;
    if (record.usedAt != null) {
      // Worth a log line: a reused token is either a double-click or someone
      // replaying a link out of a forwarded email.
      this.logger.warn(`Replayed ${type} token for user ${record.userId}`);
      throw invalid;
    }
    if (record.expiresAt.getTime() <= Date.now()) throw invalid;

    // Conditional update, so two concurrent requests cannot both win. The
    // count is the arbiter, not the read above.
    const spent = await tx.credentialToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (spent.count !== 1) throw invalid;

    return { userId: record.userId, email: record.email };
  }

  /** Housekeeping for the retention job; expired rows have no further use. */
  async purgeExpired(before = new Date()): Promise<number> {
    const { count } = await this.prisma.credentialToken.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return count;
  }

  private ttlMs(type: CredentialTokenType): number {
    return type === 'emailVerification'
      ? this.config.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000
      : this.config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
  }
}
