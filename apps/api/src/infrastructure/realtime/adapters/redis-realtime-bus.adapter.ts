import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import type {
  RealtimeBusPort,
  RealtimeEvent,
  RealtimeEventName,
  RealtimeListener,
} from '../realtime-bus.port';

const NAMES: readonly RealtimeEventName[] = [
  'message.created',
  'conversation.read',
  'call.updated',
  'call.incoming',
];

/**
 * Redis pub/sub. A duplicate connection for the subscriber, because a client
 * in subscriber mode refuses every other command — the same reason as
 * `RedisPositionStoreAdapter`.
 */
export class RedisRealtimeBusAdapter implements RealtimeBusPort {
  readonly kind = 'redis' as const;

  private static readonly CHANNEL = 'carebridge:realtime:events';

  private readonly logger = new Logger('Realtime');
  private readonly subscriber: Redis;
  private readonly listeners: RealtimeListener[] = [];

  constructor(private readonly redis: Redis) {
    this.subscriber = redis.duplicate();

    void this.subscriber
      .subscribe(RedisRealtimeBusAdapter.CHANNEL)
      .catch((error: Error) => {
        // Warned, not thrown: without the fan-out, events reach only sockets on
        // the instance that published them. Messages are still stored, and a
        // client still sees them on its next load.
        this.logger.warn(`Could not subscribe to realtime events: ${error.message}`);
      });

    this.subscriber.on('message', (channel, payload) => {
      if (channel !== RedisRealtimeBusAdapter.CHANNEL) return;
      const event = parse(payload);
      if (!event) return;
      for (const listener of this.listeners) listener(event);
    });
  }

  async publish(event: RealtimeEvent): Promise<void> {
    if (event.userIds.length === 0) return;
    await this.redis.publish(RedisRealtimeBusAdapter.CHANNEL, JSON.stringify(event));
  }

  subscribe(listener: RealtimeListener): void {
    this.listeners.push(listener);
  }

  async close(): Promise<void> {
    this.listeners.length = 0;
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }
}

/** Defensive, for the same reason as the position store: a throw here takes the process down. */
function parse(payload: string): RealtimeEvent | null {
  try {
    const parsed = JSON.parse(payload) as Partial<RealtimeEvent>;
    if (
      !Array.isArray(parsed.userIds) ||
      !parsed.userIds.every((id) => typeof id === 'string') ||
      typeof parsed.name !== 'string' ||
      !NAMES.includes(parsed.name) ||
      typeof parsed.payload !== 'object' ||
      parsed.payload === null
    ) {
      return null;
    }
    return {
      userIds: parsed.userIds,
      name: parsed.name,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}
