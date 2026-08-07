import { checkPositionFreshness, TrackingFreshness } from './tracking';

describe('position freshness', () => {
  const now = new Date('2026-08-07T10:00:00.000Z');
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  it('accepts a reading taken just now', () => {
    expect(checkPositionFreshness(now, now)).toEqual({ ok: true });
  });

  it('accepts a reading that is merely stale', () => {
    // Stale is shown as stale, not refused. The screen says "last seen 3
    // minutes ago"; refusing the write would leave it with nothing to age.
    const stale = at(-(TrackingFreshness.staleMs + 1000));
    expect(checkPositionFreshness(stale, now).ok).toBe(true);
  });

  it('refuses a reading that is already expired on arrival', () => {
    // It would be stored as the latest known position and then immediately
    // hidden — overwriting better data with worse.
    const expired = at(-(TrackingFreshness.lostMs + 1));
    expect(checkPositionFreshness(expired, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('tolerates a device clock that runs slightly ahead', () => {
    const skewed = at(TrackingFreshness.maxClockSkewMs - 1000);
    expect(checkPositionFreshness(skewed, now).ok).toBe(true);
  });

  it('refuses a reading stamped further into the future than clock skew', () => {
    // Everything ages a position against capturedAt, so a future timestamp
    // reads as "updated just now" forever — a stale car rendered as a moving
    // one, which is the single failure mode this product cannot have.
    const future = at(TrackingFreshness.maxClockSkewMs + 1000);
    expect(checkPositionFreshness(future, now)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('keeps the thresholds the client renders against', () => {
    // These numbers are duplicated in lib/domain/models.dart. Two copies that
    // disagree would show a confident marker over a position nobody has heard
    // from, so both sides are pinned here.
    expect(TrackingFreshness.staleMs).toBe(45_000);
    expect(TrackingFreshness.lostMs).toBe(120_000);
    expect(TrackingFreshness.maxClockSkewMs).toBe(30_000);
    expect(TrackingFreshness.staleMs).toBeLessThan(TrackingFreshness.lostMs);
  });
});
