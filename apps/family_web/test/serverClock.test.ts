import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  observeServerDate,
  resetServerClock,
  serverNowMs,
} from '../src/core/serverClock';

describe('serverClock', () => {
  afterEach(() => {
    resetServerClock();
    vi.useRealTimers();
  });

  const at = (iso: string) => new Date(iso).getTime();

  it('learns how far this device is from the server', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-10-26T10:26:00.000Z'));
    // Sent and answered within 200 ms; the server said it was an hour earlier.
    observeServerDate('Mon, 26 Oct 2026 09:26:00 GMT', Date.now() - 200, Date.now());
    expect(serverNowMs() - at('2026-10-26T09:26:00.000Z')).toBeGreaterThanOrEqual(0);
    expect(serverNowMs() - at('2026-10-26T09:26:00.000Z')).toBeLessThan(1_000);
  });

  it('ignores a difference of a second or two, which is only the header rounding', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-10-26T09:26:01.400Z'));
    observeServerDate('Mon, 26 Oct 2026 09:26:00 GMT', Date.now() - 100, Date.now());
    expect(serverNowMs()).toBe(Date.now());
  });

  it('skips a slow request, an unreadable header, and no header at all', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-10-26T10:26:00.000Z'));
    observeServerDate('Mon, 26 Oct 2026 09:26:00 GMT', Date.now() - 9_000, Date.now());
    observeServerDate('yesterday-ish', Date.now() - 100, Date.now());
    observeServerDate(null, Date.now() - 100, Date.now());
    expect(serverNowMs()).toBe(Date.now());
  });
});
