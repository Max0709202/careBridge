import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ALL_CHANNELS,
  NOTIFICATION_POLICY,
  preferenceMatrix,
  type ChannelName,
  type NotificationKindName,
} from '../../domain/notification-policy';
import { ValidationError } from '../../common/errors';

export interface PreferenceRow {
  kind: NotificationKindName;
  channel: ChannelName;
  enabled: boolean;
  /** False for in-app, which is the record of what happened and not an alert. */
  configurable: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── preferences ──────────────────────────────────────────────────────────

  /**
   * The full matrix, defaults merged with whatever the user has changed.
   *
   * Returned complete rather than as "the overrides" so the settings screen
   * never has to know the defaults — which would put a second copy of the
   * policy in the client, free to drift from this one.
   */
  async preferences(userId: string): Promise<PreferenceRow[]> {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });

    const overrides = new Map(
      stored.map((row) => [`${row.kind}:${row.channel}`, row.enabled]),
    );

    return preferenceMatrix().map((cell) => ({
      kind: cell.kind,
      channel: cell.channel,
      configurable: cell.configurable,
      enabled: cell.configurable
        ? (overrides.get(`${cell.kind}:${cell.channel}`) ?? cell.defaultEnabled)
        : cell.defaultEnabled,
    }));
  }

  /**
   * Stores an override.
   *
   * A row is only written when it differs from the default, and deleted when
   * it returns to it. Keeping the table sparse is what makes a *changed*
   * default apply to everyone who never expressed an opinion — the alternative
   * is a new notification kind shipping switched off for every existing user.
   */
  async setPreference(
    userId: string,
    kind: NotificationKindName,
    channel: ChannelName,
    enabled: boolean,
  ): Promise<PreferenceRow[]> {
    const policy = NOTIFICATION_POLICY[kind]?.[channel];
    if (!policy) throw new ValidationError('Unknown notification setting.');

    if (!policy.configurable) {
      throw new ValidationError(
        'In-app notifications are the record of what happened and cannot be switched off. Email and push can.',
        'channel',
      );
    }

    if (enabled === policy.defaultEnabled) {
      await this.prisma.notificationPreference.deleteMany({
        where: {
          userId,
          kind: kind,
          channel: channel,
        },
      });
    } else {
      await this.prisma.notificationPreference.upsert({
        where: {
          userId_kind_channel: {
            userId,
            kind: kind,
            channel: channel,
          },
        },
        create: {
          userId,
          kind: kind,
          channel: channel,
          enabled,
        },
        update: { enabled },
      });
    }

    return this.preferences(userId);
  }

  /** The overrides for a set of users, shaped for the delivery worker. */
  async overridesFor(
    userIds: string[],
    kind: NotificationKindName,
  ): Promise<Map<string, Partial<Record<ChannelName, boolean>>>> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, kind: kind },
    });

    const byUser = new Map<string, Partial<Record<ChannelName, boolean>>>();
    for (const row of rows) {
      const existing = byUser.get(row.userId) ?? {};
      existing[row.channel] = row.enabled;
      byUser.set(row.userId, existing);
    }
    return byUser;
  }

  /** Exported so the settings screen can render channel names it did not invent. */
  static readonly channels = ALL_CHANNELS;

  // ─── the centre ───────────────────────────────────────────────────────────

  /**
   * Scoped by `userId` in the `where` clause rather than checked afterwards, so
   * marking someone else's notification read is not a thing the query can do.
   * A miss is silently a no-op — telling the caller their id did not match
   * anything would confirm which ids exist.
   */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
