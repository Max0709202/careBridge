import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CareApi } from '../src/api/careApi';
import { CareStore } from '../src/state/careStore';

describe('the backup poll while a trip is watched', () => {
  afterEach(() => vi.useRealTimers());

  function store() {
    // A failing read is fine here: the poll swallows it, and only the calls are counted.
    const state = vi.fn().mockRejectedValue(new Error('offline'));
    return { store: new CareStore({ state } as unknown as CareApi), state };
  }

  it('re-reads every 15 seconds while a trip is on screen, and stops when it leaves', async () => {
    vi.useFakeTimers();
    const { store: care, state } = store();

    const release = care.watchLiveTrip();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state).toHaveBeenCalledTimes(2);

    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state).toHaveBeenCalledTimes(2);
  });

  it('keeps polling while a second screen still watches, and a double release does not undercount', async () => {
    vi.useFakeTimers();
    const { store: care, state } = store();

    const first = care.watchLiveTrip();
    const second = care.watchLiveTrip();
    first();
    first();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state).toHaveBeenCalledTimes(1);

    second();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state).toHaveBeenCalledTimes(1);
  });
});
