import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundError } from '../../common/errors';

export interface SessionSummary {
  id: string;
  deviceLabel: string;
  /** So the list can render "this device" without the client guessing. */
  isCurrent: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

/**
 * The session list and its revoke buttons.
 *
 * A session here is a **refresh-token family**, not an individual token. That
 * distinction is the whole design: tokens rotate every few minutes, so a list
 * of tokens would show a person twelve entries for one phone and no way to
 * tell which to revoke. The family id is stable for the life of a sign-in, so
 * it is what a human recognises and acts on.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    userId: string,
    currentFamilyId: string | null,
  ): Promise<SessionSummary[]> {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });

    // One row per family, keeping the most recently used member as its face.
    const families = new Map<string, (typeof tokens)[number]>();
    for (const token of tokens) {
      const existing = families.get(token.familyId);
      if (!existing || token.lastUsedAt > existing.lastUsedAt) {
        families.set(token.familyId, token);
      }
    }

    return [...families.entries()].map(([familyId, token]) => ({
      id: familyId,
      deviceLabel: token.deviceLabel ?? 'Unknown device',
      isCurrent: familyId === currentFamilyId,
      createdAt: token.issuedAt.toISOString(),
      lastUsedAt: token.lastUsedAt.toISOString(),
      expiresAt: token.expiresAt.toISOString(),
    }));
  }

  /**
   * Revokes one session.
   *
   * Scoped by `userId` in the `where` clause rather than checked afterwards,
   * so signing out someone else's device is not a thing the query can express.
   * A miss is a 404 that is indistinguishable from "not yours".
   */
  async revoke(
    userId: string,
    familyId: string,
    ctx: {
      ip?: string | null;
      userAgent?: string | null;
      correlationId?: string | null;
    },
  ): Promise<void> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });

    if (count === 0) throw new NotFoundError();

    await this.audit.record({
      actorUserId: userId,
      action: 'auth.session.revoke',
      entityType: 'RefreshToken',
      entityId: familyId,
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * A best-effort, human-readable device name from the User-Agent.
   *
   * Deliberately coarse. The purpose is recognition — "was that me?" — not
   * fingerprinting, and a precise device string stored per session is a
   * tracking vector we would then have to justify in the data map.
   */
  static describeDevice(userAgent: string | null | undefined): string {
    if (!userAgent) return 'Unknown device';

    const platform = /iPhone|iPad/i.test(userAgent)
      ? 'iPhone'
      : /Android/i.test(userAgent)
        ? 'Android'
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? 'Mac'
          : /Windows/i.test(userAgent)
            ? 'Windows'
            : /Linux/i.test(userAgent)
              ? 'Linux'
              : null;

    const client = /CareBridge/i.test(userAgent)
      ? 'CareBridge app'
      : /Edg\//i.test(userAgent)
        ? 'Edge'
        : /Chrome\//i.test(userAgent)
          ? 'Chrome'
          : /Firefox\//i.test(userAgent)
            ? 'Firefox'
            : /Safari\//i.test(userAgent)
              ? 'Safari'
              : null;

    if (platform && client) return `${platform} · ${client}`;
    return platform ?? client ?? 'Unknown device';
  }
}
