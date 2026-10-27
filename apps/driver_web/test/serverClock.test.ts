import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeServerDate, resetServerClock } from '../src/core/serverClock';
import { fixToJson } from '../src/domain/models';

describe('sending positions from a phone with a wrong clock', () => {
  afterEach(() => {
    resetServerClock();
    vi.useRealTimers();
  });

  const fix = (capturedAt: Date) => ({
    latitude: 39.96,
    longitude: -83.0,
    accuracyMeters: 8,
    capturedAt,
    speedMetersPerSecond: null,
  });

  it('restates the reading on the server clock, so it is not refused as from the future', () => {
    vi.useFakeTimers();
    // The phone reads 10:26; the server says 09:26.
    vi.setSystemTime(new Date('2026-10-26T10:26:00.000Z'));
    observeServerDate('Mon, 26 Oct 2026 09:26:00 GMT', Date.now() - 100, Date.now());

    const sent = new Date(
      fixToJson(fix(new Date('2026-10-26T10:25:55.000Z'))).capturedAt,
    ).getTime();
    const expected = new Date('2026-10-26T09:25:55.000Z').getTime();
    expect(Math.abs(sent - expected)).toBeLessThan(1_000);
  });

  it('sends the phone time unchanged when the clocks agree', () => {
    const at = new Date('2026-10-26T09:25:55.000Z');
    expect(fixToJson(fix(at)).capturedAt).toBe(at.toISOString());
  });
});
