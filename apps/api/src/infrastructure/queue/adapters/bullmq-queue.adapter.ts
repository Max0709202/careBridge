import { Logger } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';

import {
  type EnqueueOptions,
  type JobHandler,
  type QueueName,
  type QueuePort,
} from '../queue.port';

/**
 * BullMQ over Redis. The real one.
 *
 * Queues and workers are created lazily per name, so a deployment that only
 * enqueues does not spin up workers it never uses — which is what will let the
 * worker process be split out from the API process without changing a call
 * site.
 */
export class BullMqQueueAdapter implements QueuePort {
  readonly driver = 'bullmq' as const;

  private readonly logger = new Logger('Queue');
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];

  constructor(private readonly connection: ConnectionOptions) {}

  private queueFor(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          // Kept briefly for debugging, then dropped. An unbounded completed
          // set is the classic way a Redis instance quietly fills up.
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 7 * 24 * 3_600 },
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue<T extends object>(
    queue: QueueName,
    name: string,
    payload: T,
    options: EnqueueOptions = {},
  ): Promise<string> {
    const job = await this.queueFor(queue).add(name, payload, {
      jobId: options.jobId,
      delay: options.delayMs,
      ...(options.attempts ? { attempts: options.attempts } : {}),
    });
    return job.id ?? options.jobId ?? name;
  }

  async cancel(queue: QueueName, jobId: string): Promise<void> {
    // `getJob` is typed `Job<any>`; narrowed here so the `any` does not
    // escape into the rest of the method.
    const job = (await this.queueFor(queue).getJob(jobId)) as Job<unknown> | undefined;
    if (!job) return;
    // Throws if the job is already active; that is a no-op for our purposes,
    // because a reminder mid-send cannot be recalled.
    await job.remove().catch(() => undefined);
  }

  registerWorker<T extends object>(queue: QueueName, handler: JobHandler<T>): void {
    const worker = new Worker(
      queue,
      async (job: Job<T>) => {
        await handler(job.data, {
          jobId: job.id ?? 'unknown',
          attempt: job.attemptsMade + 1,
        });
      },
      { connection: this.connection, concurrency: 5 },
    );

    worker.on('failed', (job, error) => {
      this.logger.error(
        `Job ${queue}/${job?.name ?? '?'} failed on attempt ${(job?.attemptsMade ?? 0) + 1}: ${error.message}`,
      );
    });

    this.workers.push(worker);
    this.logger.log(`Worker listening on "${queue}"`);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
