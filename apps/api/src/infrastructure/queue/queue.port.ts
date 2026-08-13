/**
 * The scheduling contract, independent of BullMQ.
 *
 * Two implementations exist and both are legitimate: BullMQ over Redis, which
 * is what runs anywhere with more than one process, and an in-process timer,
 * which is what runs on a laptop with no Redis. The port keeps the callers —
 * reminder scheduling, notification fan-out, retention — from caring which.
 */

/** Every queue in the system, named once so a typo is a compile error. */
export const QUEUES = {
  notifications: 'notifications',
  reminders: 'reminders',
  retention: 'retention',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface EnqueueOptions {
  /**
   * Stable, caller-derived id. Enqueuing twice with the same id is a no-op,
   * which is what makes "schedule the reminders for this appointment"
   * idempotent under retry — the alternative is a patient getting the same
   * reminder twice because a request was replayed.
   */
  jobId?: string;
  /** Fire no earlier than this many milliseconds from now. */
  delayMs?: number;
  attempts?: number;
}

export interface JobHandlerContext {
  jobId: string;
  attempt: number;
}

export type JobHandler<T> = (payload: T, context: JobHandlerContext) => Promise<void>;

export interface QueuePort {
  /** Which implementation is live. Reported at boot and by /health/ready. */
  readonly driver: 'bullmq' | 'in-process';

  enqueue<T extends object>(
    queue: QueueName,
    name: string,
    payload: T,
    options?: EnqueueOptions,
  ): Promise<string>;

  /**
   * Cancels a job that has not started. Missing or already-running jobs are a
   * silent no-op: a reminder that has already fired cannot be un-fired, and
   * treating that as an error would make every reschedule a special case.
   */
  cancel(queue: QueueName, jobId: string): Promise<void>;

  registerWorker<T extends object>(queue: QueueName, handler: JobHandler<T>): void;

  close(): Promise<void>;
}

export const QUEUE = Symbol('QUEUE');
