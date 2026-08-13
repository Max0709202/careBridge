import { Logger } from '@nestjs/common';

import {
  type EnqueueOptions,
  type JobHandler,
  type QueueName,
  type QueuePort,
} from '../queue.port';

/**
 * `setTimeout` pretending to be a queue, for a machine with no Redis.
 *
 * It is honest about what it is not, and the list matters because every item
 * is a real production requirement it fails to meet:
 *
 *   - **Nothing survives a restart.** Pending jobs are lost. The reminder
 *     scheduler compensates by re-reading `appointment_reminders` at boot, so
 *     no reminder is permanently lost — but only because the database, not the
 *     queue, is the record of intent.
 *   - **Two processes double-fire.** There is no shared state, so each
 *     instance runs its own copy of every job.
 *   - **A 24-hour delay is a 24-hour timer.** Node's timers are capped at
 *     ~24.8 days and drift; far-future reminders are re-scheduled in hops.
 *
 * Config validation refuses this adapter in production for exactly those
 * reasons. It exists so that `git clone && pnpm start:dev` works without
 * Docker, which is worth a lot on the first day of someone's employment.
 */
export class InProcessQueueAdapter implements QueuePort {
  readonly driver = 'in-process' as const;

  private readonly logger = new Logger('Queue');
  private readonly handlers = new Map<QueueName, JobHandler<never>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private closed = false;

  /** Node rejects delays above this and fires them immediately instead. */
  private static readonly MAX_TIMEOUT_MS = 2_147_483_000;

  async enqueue<T extends object>(
    queue: QueueName,
    name: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<string> {
    const jobId = options.jobId ?? `${queue}:${name}:${this.timers.size}`;

    // Same-id enqueue is a no-op, matching BullMQ. Without this the in-process
    // adapter would behave differently under retry from the real one, and the
    // difference would only show up in production.
    if (this.timers.has(jobId)) return jobId;

    this.schedule(queue, name, payload, jobId, options.delayMs ?? 0, 1);
    return jobId;
  }

  private schedule<T extends object>(
    queue: QueueName,
    name: string,
    payload: T,
    jobId: string,
    remainingMs: number,
    attempt: number,
  ): void {
    if (this.closed) return;

    const hop = Math.min(remainingMs, InProcessQueueAdapter.MAX_TIMEOUT_MS);
    const rest = remainingMs - hop;

    const timer = setTimeout(() => {
      if (rest > 0) {
        this.schedule(queue, name, payload, jobId, rest, attempt);
        return;
      }

      this.timers.delete(jobId);
      const handler = this.handlers.get(queue) as JobHandler<T> | undefined;
      if (!handler) {
        this.logger.warn(`Job ${queue}/${name} dropped: no worker registered`);
        return;
      }

      void handler(payload, { jobId, attempt }).catch((error) => {
        this.logger.error(
          `Job ${queue}/${name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, hop);

    // Do not hold the process open for a reminder that is a day away.
    timer.unref();
    this.timers.set(jobId, timer);
  }

  async cancel(_queue: QueueName, jobId: string): Promise<void> {
    const timer = this.timers.get(jobId);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(jobId);
  }

  registerWorker<T extends object>(queue: QueueName, handler: JobHandler<T>): void {
    // `JobHandler` is contravariant in its payload, so a handler for any T is
    // already assignable to the `never` slot the map stores.
    this.handlers.set(queue, handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
