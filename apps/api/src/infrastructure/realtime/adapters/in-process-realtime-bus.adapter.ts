import type {
  RealtimeBusPort,
  RealtimeEvent,
  RealtimeListener,
} from '../realtime-bus.port';

/**
 * Listeners in a list. An event published on this instance reaches sockets on
 * this instance only — see the port for why that is acceptable here and
 * refused in production.
 */
export class InProcessRealtimeBusAdapter implements RealtimeBusPort {
  readonly kind = 'in-process' as const;

  private readonly listeners: RealtimeListener[] = [];
  private closed = false;

  async publish(event: RealtimeEvent): Promise<void> {
    if (this.closed || event.userIds.length === 0) return;
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: RealtimeListener): void {
    this.listeners.push(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.length = 0;
  }
}
