import { InProcessPositionStoreAdapter } from './in-process-position-store.adapter';
import { TrackingFreshness } from '../../../domain/tracking';
import type { LivePosition } from '../position-store.port';

/**
 * The local position store.
 *
 * The property worth testing is the expiry, because it is the one the whole
 * tracking design rests on: a stored position stops being readable at exactly
 * the moment the domain says it has stopped being a position. Get that wrong
 * and a driver whose phone died leaves a marker sitting on a family's map,
 * which is the single failure mode this product cannot have.
 */

function position(overrides: Partial<LivePosition> = {}): LivePosition {
  return {
    rideId: 'ride-1',
    latitude: 40.651,
    longitude: -73.958,
    accuracyMeters: 10,
    capturedAt: new Date().toISOString(),
    etaMinutes: 7,
    ...overrides,
  };
}

describe('storing a position', () => {
  it('reads back what was written', async () => {
    const store = new InProcessPositionStoreAdapter();
    await store.publish(position());

    const latest = await store.latest('ride-1');
    expect(latest?.latitude).toBeCloseTo(40.651);
    expect(latest?.etaMinutes).toBe(7);
  });

  it('has nothing for a ride nobody has reported', async () => {
    const store = new InProcessPositionStoreAdapter();
    expect(await store.latest('ride-unknown')).toBeNull();
  });

  it('keeps the newest report for a ride', async () => {
    const store = new InProcessPositionStoreAdapter();
    await store.publish(position({ latitude: 1 }));
    await store.publish(position({ latitude: 2 }));

    expect((await store.latest('ride-1'))?.latitude).toBe(2);
  });
});

describe('expiry', () => {
  it('refuses a position older than the domain says a position lasts', async () => {
    const store = new InProcessPositionStoreAdapter();

    await store.publish(
      position({
        capturedAt: new Date(
          Date.now() - TrackingFreshness.lostMs - 1_000,
        ).toISOString(),
      }),
    );

    expect(await store.latest('ride-1')).toBeNull();
  });

  it('still serves one that is stale but not lost', async () => {
    // Between `staleMs` and `lostMs` the position is shown *and marked* as
    // possibly out of date. That is the client's job; the store's job is only
    // to stop serving it at `lostMs`.
    const store = new InProcessPositionStoreAdapter();

    await store.publish(
      position({
        capturedAt: new Date(
          Date.now() - TrackingFreshness.staleMs - 1_000,
        ).toISOString(),
      }),
    );

    expect(await store.latest('ride-1')).not.toBeNull();
  });

  it('drops an expired entry rather than re-checking it forever', async () => {
    const store = new InProcessPositionStoreAdapter();
    await store.publish(
      position({
        capturedAt: new Date(Date.now() - TrackingFreshness.lostMs * 2).toISOString(),
      }),
    );

    await store.latest('ride-1');
    // Second read finds nothing at all, not an entry it must age again. A
    // store that kept every expired position would grow by one entry per ride
    // for the life of the process.
    expect(await store.latest('ride-1')).toBeNull();
  });
});

describe('forgetting', () => {
  it('drops a position immediately, without waiting for it to expire', async () => {
    // Called the instant a ride ends. Waiting for the TTL would leave a
    // finished trip's last position readable for up to two minutes, and the
    // rule is that location stops being available when the ride ends.
    const store = new InProcessPositionStoreAdapter();
    await store.publish(position());

    await store.forget('ride-1');
    expect(await store.latest('ride-1')).toBeNull();
  });

  it('is a no-op for a ride with no position', async () => {
    const store = new InProcessPositionStoreAdapter();
    await expect(store.forget('ride-unknown')).resolves.toBeUndefined();
  });
});

describe('fan-out', () => {
  it('tells every listener about each published position', async () => {
    const store = new InProcessPositionStoreAdapter();
    const seen: LivePosition[] = [];
    store.subscribe((p) => seen.push(p));
    store.subscribe((p) => seen.push(p));

    await store.publish(position());
    expect(seen).toHaveLength(2);
  });

  it('stops listening once closed', async () => {
    const store = new InProcessPositionStoreAdapter();
    const seen: LivePosition[] = [];
    store.subscribe((p) => seen.push(p));

    await store.close();
    await store.publish(position());

    expect(seen).toHaveLength(0);
    expect(await store.latest('ride-1')).toBeNull();
  });

  it('reports which implementation it is', () => {
    // Read at boot and by /health/ready. "Which adapter is live" is the first
    // question anybody asks when a map is not updating.
    expect(new InProcessPositionStoreAdapter().kind).toBe('in-process');
  });
});
