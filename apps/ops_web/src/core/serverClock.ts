/**
 * The time according to the server, for anything aged against a reading.
 *
 * A position's age is "now minus when the device took it", and both ends of
 * that subtraction must come from the same clock. The reading is stamped by
 * the driver's phone and checked by the server; "now" was this device's own
 * clock — so a laptop an hour fast showed every live car as lost an hour ago.
 *
 * Every API response carries a `Date` header. The difference between it and
 * this device's clock, measured at the midpoint of the request, is the offset
 * applied here. The header has one-second resolution, so offsets under a few
 * seconds are ignored: the freshness thresholds are 45 and 120 seconds, and a
 * correction that jitters by a second every request would only add noise.
 */

/** Below this the device clock is trusted as it is. */
const IGNORE_BELOW_MS = 3_000;

/** A slow request says little about either clock; its sample is skipped. */
const MAX_ROUND_TRIP_MS = 5_000;

let offsetMs = 0;

/** Called with each response's `Date` header and when the request was sent and answered. */
export function observeServerDate(header: string | null, sentAt: number, receivedAt: number): void {
  if (!header || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return;
  const server = Date.parse(header);
  if (Number.isNaN(server)) return;
  // The header is truncated to the second; half a second is its expected error.
  const sample = server + 500 - (sentAt + receivedAt) / 2;
  offsetMs = Math.abs(sample) < IGNORE_BELOW_MS ? 0 : sample;
}

/** Milliseconds since the epoch, as the server's clock would read now. */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

export function serverNow(): Date {
  return new Date(serverNowMs());
}

/** For tests. */
export function resetServerClock(): void {
  offsetMs = 0;
}
