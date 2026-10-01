import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QUEUE, QUEUES, type QueuePort } from '../../infrastructure/queue/queue.port';
import { AccountDeletionService } from '../auth/account-deletion.service';
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
 *
 * Account deletion is executed here too, and that is a deliberate choice
 * rather than convenience — ADR-0013 step 4. A job scheduled at request time
 * can be lost by a restart, and a deletion that was requested and then
 * silently never happened is the worst failure this feature has. A sweep
 * cannot be forgotten: the row still says a deletion is due, so the next pass
 * picks it up.
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
    /**
     * Idempotency claims. A retry arrives within seconds; a day covers a
     * client that queued the request while offline, and keeping them longer
     * only preserves a hash of a request nobody is going to repeat.
     */
    idempotencyHours: 24,
    /**
     * Conversations, a year after the last word in them (ADR-0014). Long
     * enough to answer "what were we told about the March pickup" in a
     * dispute; not so long that a chat about somebody's grandmother is kept
     * for as long as the billing records are.
     */
    conversationDays: 365,
    /** A thread opened and never written in. Nothing to keep. */
    emptyConversationDays: 7,
    /** The call log: who rang whom and for how long. Never a number, never a recording. */
    callSessionDays: 365,
  };

  /** Daily is often enough for windows measured in weeks. */
  private static readonly INTERVAL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialTokensService,
    private readonly deletions: AccountDeletionService,
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

    await this.step(results, 'idempotencyRecords', () =>
      this.prisma.idempotencyRecord
        .deleteMany({
          where: { createdAt: { lt: hoursBefore(now, windows.idempotencyHours) } },
        })
        .then((r) => r.count),
    );

    // Deleting a conversation takes its messages, read markers and message
    // notifications with it (cascade); a call placed from it keeps its row,
    // unlinked, until its own window below.
    await this.step(results, 'conversations', () =>
      this.prisma.conversation
        .deleteMany({
          where: {
            OR: [
              { lastMessageAt: { lt: daysBefore(now, windows.conversationDays) } },
              {
                lastMessageAt: null,
                createdAt: { lt: daysBefore(now, windows.emptyConversationDays) },
              },
            ],
          },
        })
        .then((r) => r.count),
    );

    await this.step(results, 'callSessions', () =>
      this.prisma.callSession
        .deleteMany({
          where: { startedAt: { lt: daysBefore(now, windows.callSessionDays) } },
        })
        .then((r) => r.count),
    );

    // Accounts whose thirty days have run out. Isolated like every other step:
    // an erasure that fails must not stop the windows below it, and the
    // account stays due until one succeeds.
    await this.step(results, 'accountDeletions', () => this.deletions.executeDue(now));

    // And the patients those deletions orphaned, thirty days after the
    // erasure that left them with nobody. A purge empties the record rather
    // than deleting the row — `Ride.patientId` cascades, and a completed ride
    // and its fare are the one thing "delete my account" must not take with
    // it.
    await this.step(results, 'patientPurges', () =>
      this.deletions.purgeOrphanedPatients(now),
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
  return hoursBefore(now, days * 24);
}

function hoursBefore(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}
