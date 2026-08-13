import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MAIL, type MailPort } from '../../infrastructure/mail/mail.port';
import { PUSH, type PushPort } from '../../infrastructure/push/push.port';
import { QUEUE, QUEUES, type QueuePort } from '../../infrastructure/queue/queue.port';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { NotificationsService } from './notifications.service';
import { resolveChannels, type ChannelName } from '../../domain/notification-policy';
import { notificationEmail } from '../auth/mail-templates';

interface DeliveryJob {
  notificationId: string;
}

/**
 * What happened on one channel.
 *
 * `suppressed` is a first-class outcome rather than a failure — a user who
 * turned email off, or who has never registered a device, did not have a
 * delivery problem — and keeping the three apart is what makes the delivery
 * table answerable in a support conversation.
 */
interface Outcome {
  status: 'sent' | 'failed' | 'suppressed';
  providerRef?: string | null;
  failureReason?: string;
}

/**
 * Takes a notification row that already exists and gets it out of the building.
 *
 * The order of operations is the important part, and it is: **write the row
 * first, deliver afterwards, from a queue.**
 *
 *   - The in-app record is written inside the transaction that caused it
 *     (see `CareService.notifyPatientCircle`), so a ride transition and the
 *     notification about it either both happen or neither does.
 *   - Email and push happen afterwards, on the queue, because they are slow,
 *     they fail for reasons that have nothing to do with us, and a Stripe-like
 *     outage at SES must not roll back a completed ride.
 *
 * The consequence — which is the right one — is that the timeline is never
 * wrong even when delivery is. A notification the app shows but whose email
 * bounced is a delivery problem. A ride that silently failed to complete
 * because a push token was stale would be a correctness problem.
 */
@Injectable()
export class NotificationDispatchService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationDispatchService.name);

  /**
   * How often the outbox is swept.
   *
   * Five seconds is latency nobody notices on an email and a push — T4 already
   * establishes that even live location does not need sub-second delivery —
   * and it buys the property that matters: delivery does not depend on any
   * caller remembering to enqueue.
   */
  private static readonly SWEEP_INTERVAL_MS = 5_000;

  /** Bounded, so a backlog is worked through steadily rather than all at once. */
  private static readonly SWEEP_BATCH = 100;

  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(MAIL) private readonly mail: MailPort,
    @Inject(PUSH) private readonly push: PushPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.queue.registerWorker<DeliveryJob>(QUEUES.notifications, async (job) => {
      await this.deliver(job.notificationId);
    });

    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, NotificationDispatchService.SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * The outbox: notifications that exist but have not been dispatched.
   *
   * This is the delivery trigger, and it is a sweep rather than a call at each
   * of the seven places that create notifications — deliberately. Enqueuing
   * from inside the originating transaction produces jobs for rows that a
   * rollback then removes; enqueuing after it means every current and future
   * call site has to remember to, and one that forgets produces a
   * notification the app shows and nobody outside it ever hears about. A
   * sweep cannot be forgotten.
   *
   * With more than one instance, several sweeps find the same row. That is
   * harmless: the job id is derived from the notification id, so BullMQ
   * collapses the duplicates.
   */
  async sweep(): Promise<number> {
    try {
      const pending = await this.prisma.notification.findMany({
        where: { deliveries: { none: {} } },
        orderBy: { createdAt: 'asc' },
        take: NotificationDispatchService.SWEEP_BATCH,
        select: { id: true },
      });

      if (pending.length === 0) return 0;

      await this.enqueue(pending.map((row) => row.id));
      return pending.length;
    } catch (error) {
      // A sweep failure must never take the process down; the next tick
      // retries, and the rows are still in the outbox.
      this.logger.warn(
        `Notification sweep failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return 0;
    }
  }

  /** Queues delivery for specific notifications. Idempotent under retry. */
  async enqueue(notificationIds: string[]): Promise<void> {
    await Promise.all(
      notificationIds.map((notificationId) =>
        this.queue.enqueue<DeliveryJob>(
          QUEUES.notifications,
          'deliver',
          { notificationId },
          // Id derived from the row, so a retried enqueue cannot produce a
          // second copy of the same email.
          { jobId: `notify:${notificationId}` },
        ),
      ),
    );
  }

  /**
   * Fans one notification out across the channels the recipient allows.
   *
   * Each channel records its own outcome. `suppressed` is a first-class result
   * and not a failure: a user who turned email off did not have a delivery
   * problem, and treating it as one would make the delivery dashboard useless.
   */
  async deliver(notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!notification) {
      // The row was deleted between enqueue and delivery. Nothing to do, and
      // nothing worth retrying.
      this.logger.debug(`Notification ${notificationId} no longer exists`);
      return;
    }

    // `NotificationKind` from Prisma and `NotificationKindName` from the
    // policy are the same union of string literals, and the spec in
    // notification-policy.spec.ts is what keeps them that way.
    const kind = notification.kind;
    const overrides = (
      await this.notifications.overridesFor([notification.user.id], kind)
    ).get(notification.user.id);

    const channels = resolveChannels(kind, overrides);

    for (const channel of ['inApp', 'email', 'push'] as ChannelName[]) {
      if (!channels.includes(channel)) {
        await this.recordDelivery(notificationId, channel, {
          status: 'suppressed',
        });
        continue;
      }

      if (channel === 'inApp') {
        // The row itself is the in-app delivery; it was written in the
        // originating transaction.
        await this.recordDelivery(notificationId, 'inApp', { status: 'sent' });
        continue;
      }

      try {
        const outcome =
          channel === 'email'
            ? await this.sendEmail(notification.user.email, notification.title)
            : await this.sendPush(
                notification.user.id,
                notification.title,
                notification.body,
                {
                  kind: notification.kind,
                  ...(notification.rideId ? { rideId: notification.rideId } : {}),
                  ...(notification.appointmentId
                    ? { appointmentId: notification.appointmentId }
                    : {}),
                },
              );

        await this.recordDelivery(notificationId, channel, outcome);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown';
        await this.recordDelivery(notificationId, channel, {
          status: 'failed',
          failureReason: reason.slice(0, 500),
        });
        // Rethrown so the queue retries with backoff. The delivery row above
        // is written first, so the failure is visible even if every retry
        // eventually fails.
        throw error;
      }
    }
  }

  private async sendEmail(to: string, title: string): Promise<Outcome> {
    const result = await this.mail.send(
      notificationEmail({ appUrl: this.config.PUBLIC_APP_URL }, { to, title }),
    );
    return { status: 'sent', providerRef: result.providerRef };
  }

  /**
   * Pushes to the family app's devices only.
   *
   * The driver app is a separate install (D4) with a separate token set, and a
   * family notification arriving on a driver's phone would be both confusing
   * and a disclosure.
   */
  private async sendPush(
    userId: string,
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<Outcome> {
    const devices = await this.prisma.deviceToken.findMany({
      where: {
        userId,
        revokedAt: null,
        invalidatedAt: null,
        appTarget: 'family',
      },
      select: { token: true },
    });

    // No device is not a successful send. Recording it as `sent` would answer
    // "why did I not get a push?" with a delivery row that says we delivered
    // one — and cost somebody an hour before they thought to check whether the
    // account had ever registered a device.
    if (devices.length === 0) {
      return { status: 'suppressed', failureReason: 'no registered device' };
    }

    const result = await this.push.send({
      tokens: devices.map((device) => device.token),
      title,
      body,
      data,
    });

    if (result.invalidTokens.length > 0) {
      // Stop paying to push to apps that have been uninstalled.
      await this.prisma.deviceToken.updateMany({
        where: { token: { in: result.invalidTokens } },
        data: { invalidatedAt: new Date() },
      });
      this.logger.debug(
        `Marked ${result.invalidTokens.length} device token(s) invalid`,
      );
    }

    return {
      status: result.sent > 0 ? 'sent' : 'failed',
      providerRef: `${result.sent} device(s)`,
      ...(result.sent === 0
        ? { failureReason: 'every registered token was rejected' }
        : {}),
    };
  }

  private async recordDelivery(
    notificationId: string,
    channel: ChannelName,
    outcome: Outcome,
  ): Promise<void> {
    const data = {
      status: outcome.status,
      completedAt: new Date(),
      providerRef: outcome.providerRef ?? null,
      failureReason: outcome.failureReason ?? null,
    };

    await this.prisma.notificationDelivery.upsert({
      where: { notificationId_channel: { notificationId, channel } },
      create: { notificationId, channel, ...data },
      update: data,
    });
  }
}
