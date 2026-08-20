/**
 * Where a moving car's position lives while it is moving.
 *
 * Deliberately **not** the database. A position report arrives every few
 * seconds per active ride and is worth nothing thirty seconds later; writing
 * every one of them to Postgres would make the busiest table in the system the
 * one whose rows have the shortest useful life. What Postgres keeps is the
 * *sampled* history on `ride_location_samples`, for dispute resolution, and
 * the last known position on the ride row so a page load has something to
 * render. This port is the live path between those two.
 *
 * Two implementations, both legitimate — the same arrangement as the queue and
 * the rate limiter. Redis holds the position and fans it out across instances;
 * an in-process map does it on a laptop with no Redis, correctly for one
 * process and wrongly for two.
 *
 * The **TTL is the point**, and it is taken from the domain rather than chosen
 * here. A stored position expires exactly when `TrackingFreshness.lostMs` says
 * it has stopped being a position, so a driver whose phone dies cannot leave a
 * marker sitting on a family's map indefinitely. Expiry in the store and
 * "stop showing it" in the client are then the same number, and there is no
 * arrangement of the two that shows a stale car as a moving one.
 */

export interface LivePosition {
  rideId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;

  /**
   * When the **device** took the reading, ISO-8601. Never when we received it:
   * age is measured against the reading, so a report delayed by a bad network
   * is shown as old rather than as current.
   */
  capturedAt: string;

  etaMinutes: number | null;
}

export type PositionListener = (position: LivePosition) => void;

export interface PositionStorePort {
  /** Which implementation is live. Reported at boot and by /health/ready. */
  readonly kind: 'redis' | 'in-process';

  /**
   * Records the latest position for a ride and fans it out to every
   * subscriber, on this instance and any other.
   */
  publish(position: LivePosition): Promise<void>;

  /**
   * The last known position, or null if there is none or it has expired.
   *
   * Called when a client subscribes, so a family opening the app mid-journey
   * sees the car immediately rather than waiting for the next report.
   */
  latest(rideId: string): Promise<LivePosition | null>;

  /**
   * Drops a ride's position.
   *
   * Called the moment a ride reaches a terminal state. The TTL would get there
   * eventually, but "eventually" is up to two minutes of a completed trip's
   * last position still being readable, and the rule this product holds is
   * that location stops being available when the ride ends — not shortly
   * after.
   */
  forget(rideId: string): Promise<void>;

  /**
   * Registers a listener for every position published anywhere in the
   * deployment. The gateway is the only caller.
   */
  subscribe(listener: PositionListener): void;

  close(): Promise<void>;
}

export const POSITION_STORE = Symbol('POSITION_STORE');
