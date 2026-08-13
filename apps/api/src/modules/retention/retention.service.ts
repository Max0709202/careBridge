import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QUEUE, QUEUES, type QueuePort } from '../../infrastructure/queue/queue.port';
import { CredentialTokensService } from '../auth/credential-tokens.service';
import { InvitationsService } from '../care/invitations.service';
import { DevicesService } from '../care/devices.service';

/**
 * Retention, enforced by a job rather than by intention.
 *
 * FOUNDATION §9 sets the schedule and says the enforcement is a job — the
 * distinction matters, because a retention policy that lives only in a
 * document is a statement about what we would like to be true. This is the
 * thing that makes it true.
 *
 * Windows here are the Stage-2 subset. Location samples (30 days) belong to
 * Stage 3 and are included because the table already exists and the sweep is
 * the same shape; audit logs are deliberately absent, because they are
 * append-only for seven years and nothing in this service may delete one.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetentionService.name);

  private static readonly WINDOWS = {
    /** Read or not, a notification stops being useful long before this. */
    notificationDays: 90,
    /** FOUNDATION §9: sampled position history, thirty days, then gone. */
    locationSampleDays: 30,
    /** A device that has not checked in for this long is not coming back. */
    staleDeviceDays: 180,
    /** An unaccepted invitation has no evidentiary value once long expired. */
    expiredInvitationDays: 30,
  };

  /** Daily is often enough for windows measured in weeks. */
  private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialTokensService,
    private readonly invitations: InvitationsService,
    private readonly devices: DevicesService,
    @Inject(QUEUE) private readonly queue: QueuePort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue.registerWorker<{ scheduledAt: string }>(QUEUES.retention, async () => {
      await this.run();
      // Re-arms itself rather than relying on a repeatable-job feature that
      // only one of the two queue adapters has. One mechanism, both drivers.
      await this.schedule();
    });

    await this.schedule();
  }

  private async schedule(): Promise<void> {
    await this.queue.enqueue(
      QUEUES.retention,
      'sweep',
      { scheduledAt: new Date().toISOString() },
      {
        // A fixed id would be rejected as a duplicate while the previous
        // sweep's job still exists, so the day is part of it.
        jobId: `retention:${Math.floor(Date.now() / RetentionService.INTERVAL_MS) + 1}`,
        delayMs: RetentionService.INTERVAL_MS,
      },
    );
  }

  /**
   * One pass. Each step is independent and failure-isolated: a locked table or
   * a slow delete in one must not stop the others, because the alternative is
   * a single failing sweep quietly halting every retention window at once.
   */
  async run(now = new Date()): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    const windows = RetentionService.WINDOWS;

    await this.step(results, 'notifications', () =>
      this.prisma.notification
        .deleteMany({
          where: { createdAt: { lt: daysBefore(now, windows.notificationDays) } },
        })
        .then((r) => r.count),
    );

    await this.step(results, 'locationSamples', () =>
      this.prisma.rideLocationSample
        .deleteMany({
          where: { capturedAt: { lt: daysBefore(now, windows.locationSampleDays) } },
        })
        .then((r) => r.count),
    );

    await this.step(results, 'credentialTokens', () =>
      this.credentials.purgeExpired(now),
    );

    await this.step(results, 'invitations', () =>
      this.invitations.purgeExpired(daysBefore(now, windows.expiredInvitationDays)),
    );

    await this.step(results, 'deviceTokens', () =>
      this.devices.purgeStale(daysBefore(now, windows.staleDeviceDays)),
    );

    const total = Object.values(results).reduce((sum, n) => sum + n, 0);
    if (total > 0) this.logger.log({ ...results }, 'Retention sweep removed rows');

    return results;
  }

  private async step(
    results: Record<string, number>,
    name: string,
    work: () => Promise<number>,
  ): Promise<void> {
    try {
      results[name] = await work();
    } catch (error) {
      results[name] = 0;
      this.logger.error(
        `Retention step "${name}" failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
