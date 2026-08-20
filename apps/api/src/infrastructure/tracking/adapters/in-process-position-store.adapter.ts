import { TrackingFreshness } from '../../../domain/tracking';
import type {
  LivePosition,
  PositionListener,
  PositionStorePort,
} from '../position-store.port';

/**
 * A map and a list of listeners, for a machine with no Redis.
 *
 * Honest about what it is not, and the list matters because each item is a
 * real production requirement it fails to meet:
 *
 *   - **Positions do not cross processes.** A family connected to instance A
 *     never sees a report that arrived at instance B, so with more than one
 *     instance the map stops updating for some users and not others — which is
 *     worse than not working at all, because it works for whoever tested it.
 *   - **Nothing survives a restart.** Acceptable here and only here: the ride
 *     row still carries the last known position, so a reconnect re-reads it.
 *
 * Config validation refuses this in production, for the first reason.
 */
export class InProcessPositionStoreAdapter implements PositionStorePort {
  readonly kind = 'in-process' as const;

  private readonly positions = new Map<string, LivePosition>();
  private readonly listeners: PositionListener[] = [];
  private closed = false;

  async publish(position: LivePosition): Promise<void> {
    // A closed store stores nothing, matching `InProcessQueueAdapter`. Without
    // the flag, a position arriving during shutdown would be written to a map
    // that has just been cleared and then kept alive by the reference — a
    // small leak, but a confusing one to find.
    if (this.closed) return;

    this.positions.set(position.rideId, position);
    for (const listener of this.listeners) listener(position);
  }

  async latest(rideId: string): Promise<LivePosition | null> {
    const position = this.positions.get(rideId);
    if (!position) return null;

    // Expiry is enforced on read rather than by a timer per ride. A timer is a
    // handle to leak, the answer has to be computed against `now` anyway, and
    // a position that expired while nobody asked was never shown to anyone.
    const age = Date.now() - new Date(position.capturedAt).getTime();
    if (age > TrackingFreshness.lostMs) {
      this.positions.delete(rideId);
      return null;
    }

    return position;
  }

  async forget(rideId: string): Promise<void> {
    this.positions.delete(rideId);
  }

  subscribe(listener: PositionListener): void {
    this.listeners.push(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.positions.clear();
    this.listeners.length = 0;
  }
}
