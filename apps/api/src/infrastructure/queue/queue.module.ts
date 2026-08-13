import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';

import { REDIS_QUEUE_OPTIONS, RedisModule } from '../redis/redis.module';
import { QUEUE, type QueuePort } from './queue.port';
import { BullMqQueueAdapter } from './adapters/bullmq-queue.adapter';
import { InProcessQueueAdapter } from './adapters/in-process-queue.adapter';

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(@Inject(QUEUE) private readonly queue: QueuePort) {}

  async onApplicationShutdown(): Promise<void> {
    // Draining before exit is what makes a rolling deploy safe: a job that has
    // been pulled off the queue but not acknowledged would otherwise be
    // retried by the next instance, and "retried" for a notification means
    // "sent twice".
    await this.queue.close();
  }
}

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: QUEUE,
      inject: [REDIS_QUEUE_OPTIONS],
      useFactory: (options: { connection: ConnectionOptions } | null): QueuePort => {
        if (options) return new BullMqQueueAdapter(options.connection);

        new Logger('Queue').warn(
          'No Redis: using the in-process scheduler. Jobs are lost on restart and double-fire with more than one instance.',
        );
        return new InProcessQueueAdapter();
      },
    },
    QueueLifecycle,
  ],
  exports: [QUEUE],
})
export class QueueModule {}
