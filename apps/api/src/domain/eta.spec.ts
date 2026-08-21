import {
  ETA_MOVE_THRESHOLD_MILES,
  ETA_REFRESH_MS,
  decayEta,
  decideEta,
  etaTargetFor,
  fallbackEtaMinutes,
  isPlausibleEta,
  type CachedRoute,
} from './eta';
import { RIDE_STATUSES } from './ride-status';
import type { Coordinates } from './geo';

/**
 * When to ask a routing vendor, and what to say between asks.
 *
 * The rule these tests protect is that **a route does not go stale as fast as
 * a position does**. Asking for every position report would put the product
 * over its own ceiling on routing spend; asking too rarely would leave a
 * family counting down towards a stop the car is driving away from. Everything
 * here is about where that line sits.
 */

const brooklyn: Coordinates = { latitude: 40.651, longitude: -73.958 };
const nearby: Coordinates = { latitude: 40.6525, longitude: -73.9585 };
const clinic: Coordinates = { latitude: 40.6558, longitude: -73.945 };

const T0 = 1_700_000_000_000;

function cached(overrides: Partial<CachedRoute> = {}): CachedRoute {
  return {
    computedAt: T0,
    durationMinutes: 12,
    from: brooklyn,
    target: 'pickup',
    ...overrides,
  };
}

describe('which stop is being counted down to', () => {
  it('is the pickup while the driver is on the way', () => {
    expect(etaTargetFor('driverEnRoute')).toBe('pickup');
  });

  it('is the destination once the passenger is in the car', () => {
    expect(etaTargetFor('passengerOnboard')).toBe('destination');
    expect(etaTargetFor('inProgress')).toBe('destination');
  });

  it('is nothing when the car is already there', () => {
    // "Arriving in 1 minute" next to a driver standing at the door is worse
    // than no number: it is the number that makes somebody keep waiting
    // inside.
    expect(etaTargetFor('driverArrived')).toBeNull();
    expect(etaTargetFor('arrivedAtDestination')).toBeNull();
  });

  it('is nothing before a driver is moving, or after the ride is over', () => {
    for (const status of RIDE_STATUSES) {
      if (
        status === 'driverEnRoute' ||
        status === 'passengerOnboard' ||
        status === 'inProgress'
      ) {
        continue;
      }
      expect(etaTargetFor(status)).toBeNull();
    }
  });
});

describe('deciding whether to ask the vendor', () => {
  it('asks when nothing has been computed yet', () => {
    expect(decideEta(null, { at: brooklyn, target: 'pickup', now: T0 })).toEqual({
      recompute: true,
      minutes: null,
    });
  });

  it('does not ask again for a position seconds later', () => {
    // The case that decides the bill. Position reports arrive every few
    // seconds; a routing call for each of them costs roughly $0.60 on a
    // half-hour trip, against a ceiling of $0.50 a ride.
    const decision = decideEta(cached(), {
      at: nearby,
      target: 'pickup',
      now: T0 + 5_000,
    });

    expect(decision.recompute).toBe(false);
    expect(decision.minutes).toBe(12);
  });

  it('asks again once the route is a minute old', () => {
    const decision = decideEta(cached(), {
      at: brooklyn,
      target: 'pickup',
      now: T0 + ETA_REFRESH_MS,
    });

    expect(decision.recompute).toBe(true);
    // Still hands back a number to show. A screen that blanks its ETA every
    // time it refreshes is a screen that flickers, and the vendor call about
    // to be made may fail.
    expect(decision.minutes).toBe(11);
  });

  it('asks again when the car has gone somewhere the route did not expect', () => {
    // A wrong turn. Without this, the countdown keeps running towards a stop
    // the car is driving away from.
    const strayed: Coordinates = { latitude: 40.665, longitude: -73.958 };
    const decision = decideEta(cached(), {
      at: strayed,
      target: 'pickup',
      now: T0 + 5_000,
    });

    expect(decision.recompute).toBe(true);
  });

  it('tolerates ordinary progress along the route', () => {
    // Half a mile is about a minute of city driving. Tighter than this and
    // every position report on a moving car becomes a billable lookup.
    expect(ETA_MOVE_THRESHOLD_MILES).toBeGreaterThan(0);
    const decision = decideEta(cached(), {
      at: nearby,
      target: 'pickup',
      now: T0 + 5_000,
    });

    expect(decision.recompute).toBe(false);
  });

  it('throws away a countdown to a different stop', () => {
    // The passenger got in. Whatever was cached was a countdown to the house.
    const decision = decideEta(cached({ target: 'pickup' }), {
      at: brooklyn,
      target: 'destination',
      now: T0 + 1_000,
    });

    expect(decision.recompute).toBe(true);
    expect(decision.minutes).toBeNull();
  });
});

describe('the answer between asks', () => {
  it('is the last one, minus the time that has passed', () => {
    expect(decayEta(cached({ durationMinutes: 12 }), T0 + 4 * 60_000)).toBe(8);
  });

  it('never counts below one', () => {
    // "Arriving in 0 minutes" reads as a bug while the car is still moving.
    // The state where the answer is genuinely nothing is a null target.
    expect(decayEta(cached({ durationMinutes: 3 }), T0 + 10 * 60_000)).toBe(1);
    expect(decayEta(cached({ durationMinutes: 1 }), T0)).toBe(1);
  });

  it('rounds to the nearest minute rather than truncating', () => {
    expect(decayEta(cached({ durationMinutes: 12 }), T0 + 90_000)).toBe(11);
  });
});

describe('judging a vendor’s answer', () => {
  it('accepts an ordinary city journey', () => {
    expect(isPlausibleEta(9, brooklyn, clinic)).toBe(true);
  });

  it('refuses an answer no road produces', () => {
    // A ferry leg, a closed road, a units mix-up. Two hours for a mile is not
    // a slow route; it is a different question being answered.
    expect(isPlausibleEta(200, brooklyn, clinic)).toBe(false);
  });

  it('refuses one that implies flying', () => {
    expect(isPlausibleEta(0.4, brooklyn, clinic)).toBe(false);
  });

  it('refuses nonsense outright rather than clamping it', () => {
    // A number quietly bent into range is indistinguishable from a real one.
    // The fallback estimate is at least honestly derived.
    expect(isPlausibleEta(0, brooklyn, clinic)).toBe(false);
    expect(isPlausibleEta(-5, brooklyn, clinic)).toBe(false);
    expect(isPlausibleEta(Number.NaN, brooklyn, clinic)).toBe(false);
    expect(isPlausibleEta(Number.POSITIVE_INFINITY, brooklyn, clinic)).toBe(false);
  });

  it('allows a long route between two points that are close together', () => {
    // Rivers and one-way systems are real. The bound is generous in that
    // direction on purpose and only refuses what no road produces.
    const across: Coordinates = { latitude: 40.6515, longitude: -73.9585 };
    expect(isPlausibleEta(8, brooklyn, across)).toBe(true);
    // Not infinitely generous, though.
    expect(isPlausibleEta(45, brooklyn, across)).toBe(false);
  });
});

describe('when there is no vendor to ask', () => {
  it('still produces a number', () => {
    expect(fallbackEtaMinutes(brooklyn, clinic)).toBeGreaterThan(0);
  });

  it('leaves out the boarding buffer the fare estimate carries', () => {
    // That buffer is about how long the whole trip takes including getting
    // somebody into the car. A live countdown is about the car arriving, and
    // including it would put a permanent six minutes on every ETA.
    expect(fallbackEtaMinutes(brooklyn, nearby)).toBeLessThan(6);
  });

  it('never returns zero for two points that are not the same place', () => {
    expect(fallbackEtaMinutes(brooklyn, nearby)).toBeGreaterThanOrEqual(1);
    expect(fallbackEtaMinutes(brooklyn, brooklyn)).toBe(1);
  });

  it('runs slow rather than fast', () => {
    // An optimistic ETA costs a family an appointment; a pessimistic one costs
    // them a pleasant surprise.
    const straightLineMiles = 0.95;
    const minutes = fallbackEtaMinutes(brooklyn, clinic);
    expect(minutes).toBeGreaterThan(straightLineMiles);
  });
});
