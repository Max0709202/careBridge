import { AVERAGE_CITY_MPH, distanceMiles, type Coordinates } from './geo';
import type { RideStatus } from './ride-status';

/**
 * When to ask a routing vendor, and what to say between asks.
 *
 * The product's central claim is "the driver is six minutes away", so the
 * number has to be real. The constraint is that it also has to be *cheap*:
 * routing spend scales with tracked rides rather than with users, which makes
 * it the one vendor cost that grows exactly as the product succeeds (R4). A
 * position report arrives every four to ten seconds; billing a routing call
 * for each of them would cost roughly $0.60 on a half-hour trip and put the
 * product over its own ceiling of $0.50 a ride.
 *
 * The way out is that **a route does not go stale as fast as a position
 * does**. Between calls the answer is simply the last one minus the time that
 * has passed, which is exactly right while the car is doing what the route
 * said it would, and wrong in a way that re-routing corrects within a minute
 * when it is not.
 */

/**
 * Which stop the family is counting down to.
 *
 * Null in the two states where a countdown is meaningless *and misleading*:
 * the car is already at the kerb. "Arriving in 1 minute" next to a driver who
 * is standing at the door is worse than no number, because it is the number
 * that makes somebody keep waiting inside.
 */
export function etaTargetFor(status: RideStatus): 'pickup' | 'destination' | null {
  switch (status) {
    case 'driverEnRoute':
      return 'pickup';
    case 'passengerOnboard':
    case 'inProgress':
      return 'destination';
    default:
      return null;
  }
}

/** How long a computed route is reused before asking again. */
export const ETA_REFRESH_MS = 60 * 1000;

/**
 * How far the car may move before the cached route stops describing it.
 *
 * Half a mile is roughly a minute of city driving, so a wrong turn costs at
 * most that long before the next route corrects it. Tighter would re-route on
 * ordinary progress; looser would let a car that has gone the wrong way keep
 * counting down towards a stop it is driving away from.
 */
export const ETA_MOVE_THRESHOLD_MILES = 0.5;

/** A route that has been computed, and the position it was computed from. */
export interface CachedRoute {
  /** Epoch milliseconds. */
  computedAt: number;
  durationMinutes: number;
  from: Coordinates;
  target: 'pickup' | 'destination';
}

export interface EtaDecision {
  /** Whether the vendor should be asked now. */
  recompute: boolean;
  /** What to show if it is not asked, or if asking fails. */
  minutes: number | null;
}

/**
 * What to do with a position report, given whatever route is already held.
 *
 * Returns both halves deliberately: the caller needs a number to show even
 * when it is about to ask for a better one, because the vendor call may fail
 * and a screen that blanks its ETA on every refresh is a screen that flickers.
 */
export function decideEta(
  cached: CachedRoute | null,
  input: { at: Coordinates; target: 'pickup' | 'destination'; now: number },
): EtaDecision {
  if (!cached) return { recompute: true, minutes: null };

  // The stop changed — the passenger got in. Whatever was cached was a
  // countdown to a different place.
  if (cached.target !== input.target) return { recompute: true, minutes: null };

  const remaining = decayEta(cached, input.now);

  const stale = input.now - cached.computedAt >= ETA_REFRESH_MS;
  const strayed = distanceMiles(cached.from, input.at, 1) >= ETA_MOVE_THRESHOLD_MILES;

  return { recompute: stale || strayed, minutes: remaining };
}

/**
 * The cached route, aged by the time that has passed since it was computed.
 *
 * Floored at one rather than zero. "Arriving in 0 minutes" reads as a bug when
 * the car is still moving, and the state where the answer is genuinely nothing
 * is handled by [etaTargetFor] returning null.
 */
export function decayEta(cached: CachedRoute, now: number): number {
  const elapsedMinutes = (now - cached.computedAt) / 60_000;
  const remaining = cached.durationMinutes - elapsedMinutes;
  return remaining <= 1 ? 1 : Math.round(remaining);
}

/**
 * The slowest plausible speed a routing answer may imply, in miles per hour.
 *
 * Below this the vendor has returned something the product must not repeat —
 * a ferry leg, a route through a closed road, a units mix-up. Four miles an
 * hour is walking pace, and a car in the worst traffic a city has still beats
 * it over any distance worth driving.
 */
const SLOWEST_PLAUSIBLE_MPH = 4;

/** The fastest, for the mirror-image reason. Nothing here is on a motorway. */
const FASTEST_PLAUSIBLE_MPH = 90;

/**
 * Whether a vendor's answer is worth showing a family.
 *
 * Checked against the straight-line distance, which is the one thing known
 * independently of the vendor. A route may legitimately be much longer than
 * the crow flies — rivers, one-way systems — so the bound is deliberately
 * generous in that direction and only refuses the answers no road produces.
 *
 * An implausible answer is discarded rather than clamped: a number quietly
 * bent into range is indistinguishable from a real one, and the fallback
 * estimate is at least honestly derived.
 */
export function isPlausibleEta(
  minutes: number,
  from: Coordinates,
  to: Coordinates,
): boolean {
  if (!Number.isFinite(minutes) || minutes <= 0) return false;

  const straightLine = distanceMiles(from, to, 1);
  // Two points a few hundred yards apart make every speed look absurd, so
  // below a quarter of a mile only the upper bound is meaningful.
  if (straightLine < 0.25) return minutes <= 30;

  const impliedMph = straightLine / (minutes / 60);
  return impliedMph >= SLOWEST_PLAUSIBLE_MPH && impliedMph <= FASTEST_PLAUSIBLE_MPH;
}

/**
 * The answer when there is no vendor to ask.
 *
 * A straight line with a detour factor, at the same average speed the fare was
 * quoted from — which at least makes the two consistent. It runs slow rather
 * than fast on purpose: an ETA that is optimistic costs a family an
 * appointment, one that is pessimistic costs them a pleasant surprise.
 *
 * The boarding buffer that `estimateDriveMinutes` adds is deliberately *not*
 * included. That buffer belongs to a fare estimate, where the question is how
 * long the whole trip takes including getting somebody into the car; a live
 * countdown is about the car arriving, and adding it would put a permanent six
 * minutes on every ETA the product shows.
 */
export function fallbackEtaMinutes(from: Coordinates, to: Coordinates): number {
  const minutes = Math.ceil((distanceMiles(from, to) / AVERAGE_CITY_MPH) * 60);
  return minutes < 1 ? 1 : minutes;
}
