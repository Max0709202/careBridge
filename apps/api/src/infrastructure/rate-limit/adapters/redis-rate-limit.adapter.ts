import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import type {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimiterPort,
} from '../rate-limit.port';

/**
 * Counters in Redis, shared by every instance.
 *
 * A fixed window per key: `INCR`, and set the expiry on the call that created
 * it. Both commands go in one pipeline — two round trips per attempt would
 * double the cost of the cheapest endpoint in the system, and an `INCR` that
 * succeeds while its `PEXPIRE` fails leaves a key that never expires and locks
 * an address out permanently.
 *
 * A fixed window admits up to twice the limit across a boundary: eight
 * attempts at the end of one window and eight at the start of the next. A
 * sliding log would not, at the cost of a sorted set per key and a trim on
 * every request. For "stop someone grinding passwords", a factor of two at one
 * instant is not the difference between safe and unsafe, and the cheaper
 * structure is the one that survives being in front of every sign-in.
 *
 * When Redis is unreachable the decision is to **allow**. Redis is a cache and
 * never the source of truth, and the alternative — failing closed — turns a
 * cache outage into a total sign-in outage for every family at once. The
 * failure is logged at warn so it is visible while it is happening.
 */
export class RedisRateLimitAdapter implements RateLimiterPort {
  readonly kind = 'redis' as const;

  private readonly logger = new Logger('RateLimit');

  constructor(private readonly redis: Redis) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const namespaced = `ratelimit:${key}`;

    try {
      const results = await this.redis
        .multi()
        .incr(namespaced)
        // NX: only when the key has no expiry, i.e. the attempt that created
        // it. Refreshing the TTL on every attempt would extend the window for
        // as long as a caller keeps trying, which is a lockout with no end.
        .pexpire(namespaced, policy.windowMs, 'NX')
        .pttl(namespaced)
        .exec();

      const count = readNumber(results?.[0]);
      const ttlMs = readNumber(results?.[2]);

      if (count == null) throw new Error('Rate-limit counter returned no value.');

      return {
        allowed: count <= policy.limit,
        remaining: Math.max(0, policy.limit - count),
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((ttlMs != null && ttlMs > 0 ? ttlMs : policy.windowMs) / 1000),
        ),
      };
    } catch (error) {
      this.logger.warn(
        `Rate-limit check failed, allowing the request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        allowed: true,
        remaining: policy.limit,
        retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
      };
    }
  }

  async peek(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const namespaced = `ratelimit:${key}`;

    try {
      const results = await this.redis.multi().get(namespaced).pttl(namespaced).exec();

      const raw = results?.[0];
      if (raw?.[0]) throw raw[0];
      const count = typeof raw?.[1] === 'string' ? Number(raw[1]) : 0;
      const ttlMs = readNumber(results?.[1]);

      return {
        allowed: count < policy.limit,
        remaining: Math.max(0, policy.limit - count),
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((ttlMs != null && ttlMs > 0 ? ttlMs : policy.windowMs) / 1000),
        ),
      };
    } catch (error) {
      // Same call as `consume`: an unreachable cache degrades to allowing.
      this.logger.warn(
        `Rate-limit read failed, allowing the request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        allowed: true,
        remaining: policy.limit,
        retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
      };
    }
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`ratelimit:${key}`).catch((error: unknown) => {
      // Failing to clear a counter is harmless: it expires on its own, and
      // until then it only ever limits someone who has already signed in.
      this.logger.warn(
        `Could not clear rate-limit key: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}

/** `multi().exec()` yields `[error, value]` pairs, and either half can be null. */
function readNumber(entry: [Error | null, unknown] | undefined): number | null {
  if (!entry) return null;
  const [error, value] = entry;
  if (error) throw error;
  return typeof value === 'number' ? value : null;
}
