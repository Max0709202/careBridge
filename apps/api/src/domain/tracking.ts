/**
 * The bounds a position report is judged against, in one place. Mirrors
 * `TrackingFreshness` in lib/domain/models.dart, and the two must stay equal:
 * the **write** path here rejects a point outside them, and the **read** path
 * in the client uses the same numbers to decide when to warn and when to stop
 * showing a position at all. Two copies that disagree would show up as a
 * confident marker over a position nobody has heard from.
 */
export const TrackingFreshness = {
  /**
   * Roughly four missed reports at a 10-second cadence. Past this the screen
   * says the position may be out of date.
   */
  staleMs: 45 * 1000,

  /**
   * Past this we stop presenting a position as current, and stop accepting one
   * stamped that long ago.
   */
  lostMs: 2 * 60 * 1000,

  /**
   * A device clock may legitimately run slightly ahead of ours. Anything
   * further into the future is not skew — it is a reading that would render as
   * permanently fresh, which is exactly the false certainty we refuse to show.
   */
  maxClockSkewMs: 30 * 1000,
} as const;

export interface PositionCheckResult {
  ok: boolean;
  reason?: 'future' | 'expired';
}

/**
 * Judges a reading's timestamp.
 *
 * A point stamped in the future reads as "updated just now" indefinitely — a
 * stale car rendered as a moving one, the single failure mode this product
 * cannot have. A point already older than `lostMs` is refused for the
 * mirror-image reason: it would be stored as the latest known position and then
 * immediately hidden as expired, so accepting it only overwrites better data
 * with worse.
 */
export function checkPositionFreshness(
  capturedAt: Date,
  now: Date,
): PositionCheckResult {
  const ageMs = now.getTime() - capturedAt.getTime();

  if (ageMs < 0 && Math.abs(ageMs) > TrackingFreshness.maxClockSkewMs) {
    return { ok: false, reason: 'future' };
  }
  if (ageMs > TrackingFreshness.lostMs) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

/**
 * How far back a batched upload may reach.
 *
 * Deliberately outside `TrackingFreshness`, which is mirrored in the clients
 * and must stay equal to its Dart copy — this one is a server-side bound on
 * what a *flush of the offline queue* may contain, and no client needs it.
 *
 * Six hours is far longer than any dead zone a trip survives; a device that
 * has been silent longer than that was switched off, not driving, and the
 * readings it is offering are not part of a journey anybody is disputing.
 * Without a bound, a queue that never drained becomes a way to write arbitrary
 * history into a ride's record.
 */
export const LOCATION_BACKLOG_MS = 6 * 60 * 60 * 1000;
