import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import { TrackingFreshness } from '../../../domain/tracking';
import type {
  LivePosition,
  PositionListener,
  PositionStorePort,
} from '../position-store.port';

/**
 * Redis: a keyed latest-position with a TTL, plus pub/sub for the fan-out.
 *
 * Two connections, and the second is not optional. A Redis client in
 * subscriber mode refuses every other command — that is the protocol, not a
 * library quirk — so a single connection used for both `SET` and `SUBSCRIBE`
 * stops being able to write the moment it starts listening. The subscriber is
 * therefore a duplicate of the main client.
 *
 * The TTL comes from `TrackingFreshness.lostMs`, so the key expires at exactly
 * the moment the domain says a reading has stopped counting as a position.
 * That is what makes "the store forgot it" and "the client stops drawing it"
 * the same event rather than two numbers that can drift apart.
 */
export class RedisPositionStoreAdapter implements PositionStorePort {
  readonly kind = 'redis' as const;

  private readonly logger = new Logger('Tracking');
  private readonly subscriber: Redis;
  private readonly listeners: PositionListener[] = [];

  private static readonly CHANNEL = 'carebridge:tracking:positions';

  private static key(rideId: string): string {
    return `carebridge:tracking:position:${rideId}`;
  }

  constructor(private readonly redis: Redis) {
    this.subscriber = redis.duplicate();

    void this.subscriber
      .subscribe(RedisPositionStoreAdapter.CHANNEL)
      .catch((error: Error) => {
        // Warned, not thrown. Losing the fan-out degrades live tracking to
        // whatever this instance sees directly; it must not stop the process
        // that is also serving the rest of the API.
        this.logger.warn(`Could not subscribe to position updates: ${error.message}`);
      });

    this.subscriber.on('message', (channel, payload) => {
      if (channel !== RedisPositionStoreAdapter.CHANNEL) return;

      const position = parse(payload);
      if (!position) return;
      for (const listener of this.listeners) listener(position);
    });
  }

  async publish(position: LivePosition): Promise<void> {
    const payload = JSON.stringify(position);

    // The write and the fan-out in one round trip. Not a transaction: if the
    // publish half were lost the key would still be correct, and a subscriber
    // that missed one report gets the next one two seconds later.
    await this.redis
      .multi()
      .set(
        RedisPositionStoreAdapter.key(position.rideId),
        payload,
        'PX',
        TrackingFreshness.lostMs,
      )
      .publish(RedisPositionStoreAdapter.CHANNEL, payload)
      .exec();
  }

  async latest(rideId: string): Promise<LivePosition | null> {
    const payload = await this.redis.get(RedisPositionStoreAdapter.key(rideId));
    if (!payload) return null;

    const position = parse(payload);
    if (!position) return null;

    // Checked again on read even though the key carries a TTL. Redis expiry is
    // not instantaneous, and the difference between "nearly expired" and
    // "expired" is exactly the window in which a stale car would be drawn as a
    // moving one.
    const age = Date.now() - new Date(position.capturedAt).getTime();
    return age > TrackingFreshness.lostMs ? null : position;
  }

  async forget(rideId: string): Promise<void> {
    await this.redis.del(RedisPositionStoreAdapter.key(rideId));
  }

  subscribe(listener: PositionListener): void {
    this.listeners.push(listener);
  }

  async close(): Promise<void> {
    this.listeners.length = 0;
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }
}

/**
 * Reads a payload defensively.
 *
 * The channel is ours, but a malformed message must not take down the
 * subscriber that every connected family depends on — and a subscriber that
 * throws inside an event handler takes the process with it.
 */
function parse(payload: string): LivePosition | null {
  try {
    const parsed = JSON.parse(payload) as Partial<LivePosition>;

    if (
      typeof parsed.rideId !== 'string' ||
      typeof parsed.latitude !== 'number' ||
      typeof parsed.longitude !== 'number' ||
      typeof parsed.capturedAt !== 'string'
    ) {
      return null;
    }

    return {
      rideId: parsed.rideId,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracyMeters:
        typeof parsed.accuracyMeters === 'number' ? parsed.accuracyMeters : 0,
      capturedAt: parsed.capturedAt,
      etaMinutes: typeof parsed.etaMinutes === 'number' ? parsed.etaMinutes : null,
    };
  } catch {
    return null;
  }
}
