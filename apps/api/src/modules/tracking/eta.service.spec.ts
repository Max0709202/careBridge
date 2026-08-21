import { EtaService } from './eta.service';
import {
  MapsUnavailableError,
  type Coordinates,
  type GeocodeResult,
  type MapsPort,
  type RouteResult,
} from '../../infrastructure/maps/maps.port';
import { DEFAULT_CIRCUIT } from '../../domain/circuit-breaker';
import { ETA_REFRESH_MS } from '../../domain/eta';

/**
 * The number behind "the driver is six minutes away".
 *
 * Three behaviours are worth testing and none of them is "it calls the
 * vendor". They are: that it *stops* calling the vendor, because routing spend
 * is the one cost that grows exactly as the product succeeds; that a vendor
 * outage degrades the number rather than removing it; and that a hanging
 * vendor stops costing anything after a few failures, because a three-second
 * timeout per position report per ride is how an API runs out of sockets.
 */

const house: Coordinates = { latitude: 40.651, longitude: -73.958 };
const clinic: Coordinates = { latitude: 40.6558, longitude: -73.945 };

/** A maps port that records what it was asked and can be told to fail. */
class FakeMaps implements MapsPort {
  readonly driver = 'deterministic' as const;

  calls = 0;
  minutes = 9;
  behaviour: 'ok' | 'unavailable' | 'noRoute' = 'ok';

  async geocode(): Promise<GeocodeResult | null> {
    return null;
  }

  async route(): Promise<RouteResult | null> {
    this.calls += 1;
    if (this.behaviour === 'unavailable') {
      throw new MapsUnavailableError('test');
    }
    if (this.behaviour === 'noRoute') return null;
    return { distanceMiles: 2.4, durationMinutes: this.minutes, source: 'fake' };
  }
}

/** Just enough Redis for the two commands the cache uses. */
class FakeRedis {
  readonly store = new Map<string, string>();
  failing = false;

  async get(key: string): Promise<string | null> {
    if (this.failing) throw new Error('redis down');
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    if (this.failing) throw new Error('redis down');
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

function build(options: { redis?: boolean } = {}) {
  const maps = new FakeMaps();
  const redis = options.redis === false ? null : new FakeRedis();
  const service = new EtaService(
    maps,
    redis as unknown as ConstructorParameters<typeof EtaService>[1],
  );
  return { service, maps, redis };
}

const T0 = new Date('2026-06-15T14:00:00Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

function input(overrides: Partial<Parameters<EtaService['estimate']>[0]> = {}) {
  return {
    rideId: 'ride-1',
    status: 'driverEnRoute' as const,
    at: house,
    pickup: clinic,
    destination: clinic,
    now: T0,
    ...overrides,
  };
}

describe('what there is to count down to', () => {
  it('counts down to the pickup while the driver is on the way', async () => {
    const { service, maps } = build();
    expect(await service.estimate(input())).toBe(9);
    expect(maps.calls).toBe(1);
  });

  it('says nothing once the car is at the kerb', async () => {
    // And crucially does not spend a routing call to find that out.
    const { service, maps } = build();
    expect(await service.estimate(input({ status: 'driverArrived' }))).toBeNull();
    expect(maps.calls).toBe(0);
  });

  it('says nothing before the driver has set off', async () => {
    const { service, maps } = build();
    expect(await service.estimate(input({ status: 'assigned' }))).toBeNull();
    expect(maps.calls).toBe(0);
  });

  it('says nothing when the stop never geocoded', async () => {
    // The ride still works — the driver has a written address and the access
    // notes. Inventing a countdown from a coordinate we do not have would be
    // the worst of the available answers.
    const { service, maps } = build();
    expect(await service.estimate(input({ pickup: null }))).toBeNull();
    expect(maps.calls).toBe(0);
  });
});

describe('not spending money', () => {
  it('reuses the route for a position report seconds later', async () => {
    // The case that decides the bill. Reports arrive every few seconds; a call
    // for each of them costs roughly $0.60 on a half-hour trip, against a
    // ceiling of $0.50 a ride.
    const { service, maps } = build();

    await service.estimate(input());
    await service.estimate(input({ now: at(5_000) }));
    await service.estimate(input({ now: at(10_000) }));

    expect(maps.calls).toBe(1);
  });

  it('ages the answer rather than repeating it', async () => {
    // Between asks the number is the last one minus the time that has passed,
    // which is exactly right while the car is doing what the route said it
    // would — and corrected within a minute when it is not.
    const { service, maps } = build();
    await service.estimate(input());

    expect(await service.estimate(input({ now: at(45_000) }))).toBe(8);
    expect(maps.calls).toBe(1);
  });

  it('asks again once the route is a minute old', async () => {
    const { service, maps } = build();
    await service.estimate(input());
    await service.estimate(input({ now: at(ETA_REFRESH_MS) }));

    expect(maps.calls).toBe(2);
  });

  it('asks again when the passenger gets in', async () => {
    // The cached number was a countdown to the house.
    const { service, maps } = build();
    await service.estimate(input());
    await service.estimate(input({ status: 'inProgress', now: at(5_000) }));

    expect(maps.calls).toBe(2);
  });
});

describe('when the vendor is unreachable', () => {
  it('still produces a number', async () => {
    // A family looking at a map is entitled to one whatever the vendor is
    // doing. A straight line is worse than a route and enormously better than
    // a blank.
    const { service, maps } = build();
    maps.behaviour = 'unavailable';

    expect(await service.estimate(input())).toBeGreaterThan(0);
  });

  it('keeps showing the last real answer while it can', async () => {
    const { service, maps } = build();
    await service.estimate(input());
    maps.behaviour = 'unavailable';

    // The route is a minute old, so it asks — and fails — but the number the
    // family sees is the decayed real one rather than a straight-line guess.
    expect(await service.estimate(input({ now: at(ETA_REFRESH_MS) }))).toBe(8);
  });

  it('stops calling after a few failures', async () => {
    // The whole point of the breaker. Each failure costs a three-second
    // timeout, and with a hundred rides in the air that is a hundred sockets
    // waiting on a vendor that is not answering.
    const { service, maps } = build();
    maps.behaviour = 'unavailable';

    for (let i = 0; i < 10; i++) {
      await service.estimate(input({ rideId: `ride-${i}`, now: at(i * 100) }));
    }

    expect(maps.calls).toBe(DEFAULT_CIRCUIT.failureThreshold);
  });

  it('recovers on its own once the vendor comes back', async () => {
    const { service, maps } = build();
    maps.behaviour = 'unavailable';
    for (let i = 0; i < 5; i++) {
      await service.estimate(input({ rideId: `ride-${i}` }));
    }
    const duringOutage = maps.calls;

    maps.behaviour = 'ok';
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + DEFAULT_CIRCUIT.cooldownMs + 1);

    try {
      expect(await service.estimate(input({ rideId: 'ride-after' }))).toBe(9);
      expect(maps.calls).toBe(duringOutage + 1);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('when the vendor answers with nonsense', () => {
  it('discards an implausible route rather than showing it', async () => {
    // Two hours for a mile is not a slow route; it is a different question
    // being answered — a ferry leg, a closed road, a units mix-up.
    const { service, maps } = build();
    maps.minutes = 400;

    const minutes = await service.estimate(input());
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThan(60);
  });

  it('does not open the breaker for it', async () => {
    // The vendor is answering. It is answering badly, which is a different
    // problem and not one that stopping the calls would fix.
    const { service, maps } = build();
    maps.minutes = 400;

    for (let i = 0; i < 5; i++) {
      await service.estimate(input({ rideId: `ride-${i}` }));
    }
    expect(maps.calls).toBe(5);
  });

  it('treats "no road between these points" as an answer, not a failure', async () => {
    const { service, maps } = build();
    maps.behaviour = 'noRoute';

    for (let i = 0; i < 5; i++) {
      await service.estimate(input({ rideId: `ride-${i}` }));
    }
    // The breaker stays closed: asking again would not conjure a road, but the
    // vendor is plainly working.
    expect(maps.calls).toBe(5);
  });
});

describe('the cache itself', () => {
  it('behaves the same with no Redis, just not across instances', async () => {
    // Unlike the position store, a missing shared cache here is a cost problem
    // and not a correctness one: every instance computes its own answer, and
    // every answer is right. So it degrades to a local map rather than being
    // refused at boot — and the behaviour a test can see, one lookup a minute
    // per ride, is the same wherever it runs.
    const { service, maps } = build({ redis: false });

    await service.estimate(input());
    await service.estimate(input({ now: at(5_000) }));

    expect(maps.calls).toBe(1);
  });

  it('forgets a ride with no Redis too', async () => {
    const { service, maps } = build({ redis: false });
    await service.estimate(input());
    await service.forget('ride-1');

    await service.estimate(input({ now: at(5_000) }));
    expect(maps.calls).toBe(2);
  });

  it('lets a locally cached route expire', async () => {
    // Expiry on read rather than on a timer: a timer is a handle to leak, and
    // a route that expired while nobody asked was never shown to anyone.
    const { service, maps } = build({ redis: false });
    await service.estimate(input());

    await service.estimate(input({ now: at(10 * 60_000) }));
    expect(maps.calls).toBe(2);
  });

  it('treats a Redis failure as a miss, never as an error', async () => {
    const { service, redis } = build();
    redis!.failing = true;

    await expect(service.estimate(input())).resolves.toBe(9);
  });

  it('treats a value it cannot read as a miss', async () => {
    // A rolling deploy has two versions of this code reading the same keys.
    const { service, redis, maps } = build();
    redis!.store.set('eta:route:ride-1', '{"computedAt":"yesterday"}');

    expect(await service.estimate(input())).toBe(9);
    expect(maps.calls).toBe(1);
  });

  it('forgets a ride that has ended', async () => {
    const { service, redis, maps } = build();
    await service.estimate(input());
    await service.forget('ride-1');

    expect(redis!.store.size).toBe(0);
    await service.estimate(input({ now: at(5_000) }));
    expect(maps.calls).toBe(2);
  });

  it('forgetting is safe for a ride nobody has routed', async () => {
    const { service } = build({ redis: false });
    await expect(service.forget('ride-unknown')).resolves.toBeUndefined();
  });
});
