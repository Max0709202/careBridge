import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';

/**
 * The Redis connection, or `null`.
 *
 * Null is a supported state, not a broken one. Redis is a cache and never the
 * source of truth (FOUNDATION §4): without it the API runs with an in-process
 * scheduler and no shared rate-limit state, which is correct on one developer
 * machine and refused outright in production by config validation.
 */
export const REDIS = Symbol('REDIS');
export type RedisConnection = Redis | null;

/**
 * BullMQ needs its own connection with `maxRetriesPerRequest: null`, because a
 * blocking `BRPOPLPUSH` legitimately sits open for minutes and ioredis would
 * otherwise time it out and tear the worker down.
 */
export const REDIS_QUEUE_OPTIONS = Symbol('REDIS_QUEUE_OPTIONS');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('Redis');

  constructor(@Inject(REDIS) private readonly redis: RedisConnection) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.redis) return;
    // `quit` rather than `disconnect`: it lets in-flight commands finish, so a
    // rolling deploy does not abandon a job mid-acknowledgement.
    await this.redis.quit().catch(() => this.redis?.disconnect());
    this.logger.log('Redis connection closed');
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): RedisConnection => {
        if (!config.REDIS_URL) return null;

        const logger = new Logger('Redis');
        const client = new Redis(config.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          // Bounded exponential backoff. Unbounded retry against a cache that
          // is genuinely gone turns a degraded system into a busy one.
          retryStrategy: (times) => Math.min(times * 200, 5_000),
          lazyConnect: false,
        });

        client.on('error', (error: Error) => {
          // Warn, not error: losing Redis degrades the system by design. It
          // must be visible without paging someone for a cache blip.
          logger.warn(`Redis unavailable: ${error.message}`);
        });
        client.on('ready', () => logger.log('Redis ready'));

        return client;
      },
    },
    {
      provide: REDIS_QUEUE_OPTIONS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.REDIS_URL
          ? { connection: { url: config.REDIS_URL, maxRetriesPerRequest: null } }
          : null,
    },
    RedisLifecycle,
  ],
  exports: [REDIS, REDIS_QUEUE_OPTIONS],
})
export class RedisModule {}
