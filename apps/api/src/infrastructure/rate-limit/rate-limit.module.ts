import { Global, Logger, Module } from '@nestjs/common';

import { REDIS, RedisModule, type RedisConnection } from '../redis/redis.module';
import { RATE_LIMITER, type RateLimiterPort } from './rate-limit.port';
import { InProcessRateLimitAdapter } from './adapters/in-process-rate-limit.adapter';
import { RedisRateLimitAdapter } from './adapters/redis-rate-limit.adapter';

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: RATE_LIMITER,
      inject: [REDIS],
      useFactory: (redis: RedisConnection): RateLimiterPort => {
        if (redis) return new RedisRateLimitAdapter(redis);

        // Said out loud at boot for the same reason the scheduler is: an
        // adapter that succeeds while doing less than you think is the failure
        // mode hardest to notice. Two instances with in-process counters
        // enforce twice the configured limit and nothing anywhere reports it.
        new Logger('RateLimit').warn(
          'No Redis: rate-limit counters are per-process. With more than one instance the effective limit multiplies by the instance count.',
        );
        return new InProcessRateLimitAdapter();
      },
    },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
