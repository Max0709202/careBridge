import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QUEUE, QUEUES, type QueuePort } from '../../infrastructure/queue/queue.port';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { CareService } from './care.service';
import { scheduleReminders } from '../../domain/reminder-schedule';

interface ReminderJob {
  reminderId: string;
}

/**
 * Appointment reminders.
 *
 * The split that makes this survivable: **the database row is the record of
 * intent, the queue job is only the timer.** Redis is a cache and may be lost
 * (FOUNDATION §4). If the queue were the only record, a Redis flush would
 * silently cancel every reminder in the system and nobody would find out until
 * a patient missed an appointment. Because `appointment_reminders` is
 * authoritative, `rehydrate()` at boot puts the timers back.
 *
 * The unique constraint on `(appointmentId, offsetMinutes)` is what makes
 * rescheduling idempotent: a retried request cannot produce a second copy of
 * the same reminder.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly care: CareService,
    @Inject(QUEUE) private readonly queue: QueuePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue.registerWorker<ReminderJob>(QUEUES.reminders, async (job) => {
      await this.fire(job.reminderId);
    });

    await this.rehydrate();
  }

  /**
   * Writes the reminder rows for an appointment, replacing any it already has.
   *
   * Takes the transaction client, so reminders and the appointment they belong
   * to commit together — an appointment that exists without its reminders is a
   * silent failure of the product's core promise.
   *
   * Enqueuing happens outside, in `enqueuePending`, because a job for a row a
   * rollback then removes is a job whose only sane outcome is to give up.
   */
  async planFor(
    tx: Prisma.TransactionClient,
    appointment: { id: string; startsAt: Date; timeZone: string },
    now = new Date(),
  ): Promise<void> {
    const planned = scheduleReminders({
      startsAt: appointment.startsAt,
      timeZone: appointment.timeZone,
      offsetMinutes: this.config.APPOINTMENT_REMINDER_OFFSETS,
      now,
    });

    // Anything previously scheduled and not yet sent is cancelled first: a
    // rescheduled appointment must not keep the reminder for its old time.
    // Cancelled rather than deleted, so "why did I not get a reminder" has an
    // answer in the data.
    const existing = await tx.appointmentReminder.findMany({
      where: { appointmentId: appointment.id, sentAt: null, cancelledAt: null },
    });

    await tx.appointmentReminder.updateMany({
      where: { appointmentId: appointment.id, sentAt: null, cancelledAt: null },
      data: { cancelledAt: new Date(), jobId: null },
    });

    for (const reminder of planned) {
      await tx.appointmentReminder.upsert({
        where: {
          appointmentId_offsetMinutes: {
            appointmentId: appointment.id,
            offsetMinutes: reminder.offsetMinutes,
          },
        },
        create: {
          appointmentId: appointment.id,
          offsetMinutes: reminder.offsetMinutes,
          scheduledFor: reminder.scheduledFor,
        },
        update: {
          scheduledFor: reminder.scheduledFor,
          cancelledAt: null,
          sentAt: null,
          jobId: null,
        },
      });
    }

    // The old timers are cancelled on a best-effort basis. If one survives, the
    // job finds a cancelled row and does nothing — the row, not the timer, is
    // what decides whether a reminder fires.
    for (const stale of existing) {
      if (stale.jobId) {
        await this.queue.cancel(QUEUES.reminders, stale.jobId).catch(() => undefined);
      }
    }
  }

  /**
   * Sets timers for reminder rows that do not have one.
   *
   * Called after the transaction commits, and again at boot. Idempotent: the
   * job id is derived from the reminder id, so re-enqueuing the same reminder
   * is a no-op rather than a second notification.
   */
  async enqueuePending(appointmentId?: string): Promise<number> {
    const pending = await this.prisma.appointmentReminder.findMany({
      where: {
        ...(appointmentId ? { appointmentId } : {}),
        sentAt: null,
        cancelledAt: null,
        scheduledFor: { gt: new Date() },
      },
      take: 500,
    });

    for (const reminder of pending) {
      const jobId = `reminder:${reminder.id}`;
      await this.queue.enqueue<ReminderJob>(
        QUEUES.reminders,
        'appointment-reminder',
        { reminderId: reminder.id },
        {
          jobId,
          delayMs: Math.max(reminder.scheduledFor.getTime() - Date.now(), 0),
        },
      );

      if (reminder.jobId !== jobId) {
        await this.prisma.appointmentReminder.update({
          where: { id: reminder.id },
          data: { jobId },
        });
      }
    }

    return pending.length;
  }

  /**
   * Puts the timers back after a restart.
   *
   * This is the method that makes the in-process scheduler survivable at all,
   * and it is why Redis being a cache is a design position rather than a
   * hopeful one.
   */
  async rehydrate(): Promise<void> {
    try {
      const restored = await this.enqueuePending();
      if (restored > 0) {
        this.logger.log(`Re-armed ${restored} pending appointment reminder(s)`);
      }
    } catch (error) {
      this.logger.error(
        `Could not re-arm reminders: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Sends one reminder.
   *
   * Re-reads the row rather than trusting the job payload, because between
   * scheduling and firing the appointment may have been cancelled,
   * rescheduled, or had the reminder switched off — and a timer has no way to
   * know any of that.
   */
  async fire(reminderId: string): Promise<void> {
    const reminder = await this.prisma.appointmentReminder.findUnique({
      where: { id: reminderId },
      include: {
        appointment: { select: { id: true, patientId: true, status: true } },
      },
    });

    if (!reminder) return;
    if (reminder.sentAt != null || reminder.cancelledAt != null) return;

    // Nothing to remind anyone about if the appointment is over or off.
    if (['canceled', 'completed', 'missed'].includes(reminder.appointment.status)) {
      await this.prisma.appointmentReminder.update({
        where: { id: reminderId },
        data: { cancelledAt: new Date() },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Conditional update first, so two workers racing the same job cannot
      // both send it.
      const claimed = await tx.appointmentReminder.updateMany({
        where: { id: reminderId, sentAt: null, cancelledAt: null },
        data: { sentAt: new Date() },
      });
      if (claimed.count !== 1) return;

      // Contentless, like every other notification: no clinic, no time, no
      // patient name. It says something is coming and asks them to look.
      await this.care.notifyPatientCircle(tx, reminder.appointment.patientId, {
        kind: 'appointmentReminder',
        title: 'An appointment is coming up',
        body: 'Open CareBridge to check the details and the transport.',
        appointmentId: reminder.appointment.id,
      });
    });
  }

  /** Cancelling an appointment cancels its outstanding reminders. */
  async cancelFor(tx: Prisma.TransactionClient, appointmentId: string): Promise<void> {
    await tx.appointmentReminder.updateMany({
      where: { appointmentId, sentAt: null, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
  }
}
