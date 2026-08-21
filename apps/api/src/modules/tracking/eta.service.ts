import { Inject, Injectable, Logger } from '@nestjs/common';

import { REDIS, type RedisConnection } from '../../infrastructure/redis/redis.module';
import {
  MAPS,
  MapsUnavailableError,
  type Coordinates,
  type MapsPort,
} from '../../infrastructure/maps/maps.port';
import {
  attempt,
  newCircuit,
  recordFailure,
  recordSuccess,
  type CircuitSnapshot,
} from '../../domain/circuit-breaker';
import {
  ETA_REFRESH_MS,
  decideEta,
  etaTargetFor,
  fallbackEtaMinutes,
  isPlausibleEta,
  type CachedRoute,
} from '../../domain/eta';
import type { RideStatus } from '../../domain/ride-status';

/**
 * How long a computed route is kept, and both ends of it are load bearing.
 *
 * It has to outlive the refresh interval, or a failed vendor call would find
 * nothing to fall back to and the ETA would blank every time it refreshed. It
 * must not outlive it by much, because a route that keeps being decayed
 * without ever being recomputed counts down to one minute and then sits there
 * — and "arriving in 1 minute" for ten minutes is a worse answer than an
 * honest straight-line estimate. Five minutes is where a vendor outage stops
 * being a stale number and starts being a fallback.
 */
const CACHE_TTL_MS = ETA_REFRESH_MS * 5;

export interface EtaInput {
  rideId: string;
  status: RideStatus;
  /** Where the driver just reported being. */
  at: Coordinates;
  pickup: Coordinates | null;
  destination: Coordinates | null;
  now: Date;
}

/**
 * How many minutes until the car reaches the stop the family is waiting on.
 *
 * The product's central claim is "the driver is six minutes away", so this is
 * the number that has to be right. Three things sit between the claim and a
 * routing vendor, and each exists for a different reason:
 *
 *   - **A cache**, because routing spend scales with tracked rides rather than
 *     with users — the one vendor cost that grows exactly as the product
 *     succeeds (R4). A route is reused for a minute, aged by the time that has
 *     passed, and only recomputed when it stops describing where the car is.
 *   - **A circuit breaker**, because a failed call costs a three-second
 *     timeout and position reports arrive every few seconds per ride. A vendor
 *     that hangs would otherwise turn a hundred live rides into a hundred
 *     sockets waiting, and the API would stop being able to do anything else.
 *   - **A fallback**, because a family looking at a map is entitled to a
 *     number whatever the vendor is doing. A straight line at a conservative
 *     average is worse than a real route and enormously better than a blank.
 *
 * There is one thing it deliberately does not do: trust the client. The ETA is
 * computed here and nowhere else, because an ETA is a promise the product
 * makes, and letting the reporting device supply it would mean anything
 * holding a driver's token could tell a family "two minutes" indefinitely.
 */
@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);

  /**
   * Per-process, and not shared through Redis on purpose.
   *
   * A breaker is about protecting *this* process from hanging on a dead
   * vendor. Sharing it would let one instance's network problem silence the
   * others, which is the opposite of what it is for — and a shared breaker is
   * a distributed lock with all of the failure modes that implies.
   */
  private circuit: CircuitSnapshot = newCircuit();

  /** Used only when there is no Redis to share a cache through. */
  private readonly local = new LocalRouteCache();

  constructor(
    @Inject(MAPS) private readonly maps: MapsPort,
    @Inject(REDIS) private readonly redis: RedisConnection,
  ) {}

  /**
   * The ETA to show for this position report, or null when there is nothing
   * to count down to.
   */
  async estimate(input: EtaInput): Promise<number | null> {
    const target = etaTargetFor(input.status);
    if (!target) return null;

    const to = target === 'pickup' ? input.pickup : input.destination;
    // An address that never geocoded. The ride still works — a driver has the
    // written address and the access notes — but there is no countdown to
    // offer, and inventing one from a coordinate we do not have would be the
    // worst of the available answers.
    if (!to) return null;

    const now = input.now.getTime();
    const cached = await this.readRoute(input.rideId);
    const decision = decideEta(cached, { at: input.at, target, now });

    if (!decision.recompute) return decision.minutes;

    const fresh = await this.recompute(input.at, to);
    if (fresh === null) {
      // No vendor answer. Whatever the cache still says beats nothing; only
      // when there is not even that does the straight line come out.
      return decision.minutes ?? fallbackEtaMinutes(input.at, to);
    }

    await this.writeRoute(input.rideId, {
      computedAt: now,
      durationMinutes: fresh,
      from: input.at,
      target,
    });
    return fresh;
  }

  /** Called when a ride ends, so a finished trip is not still cached. */
  async forget(rideId: string): Promise<void> {
    this.local.delete(rideId);
    if (!this.redis) return;
    await this.redis.del(keyFor(rideId)).catch(() => undefined);
  }

  // ─── the vendor, behind the breaker ───────────────────────────────────────

  private async recompute(from: Coordinates, to: Coordinates): Promise<number | null> {
    const gate = attempt(this.circuit, Date.now());
    this.circuit = gate.circuit;
    if (!gate.allowed) return null;

    try {
      const route = await this.maps.route(from, to);
      // A null route is a real answer — there is no road between these two
      // points — so the vendor is working and the breaker closes.
      this.circuit = recordSuccess(this.circuit);
      if (!route) return null;

      if (!isPlausibleEta(route.durationMinutes, from, to)) {
        // Discarded rather than clamped. A number quietly bent into range is
        // indistinguishable from a real one, and the fallback is at least
        // honestly derived.
        this.logger.warn(
          `Discarding implausible route: ${route.durationMinutes} minutes from ${route.source}`,
        );
        return null;
      }

      return route.durationMinutes;
    } catch (error) {
      this.circuit = recordFailure(this.circuit, Date.now());
      if (this.circuit.state === 'open') {
        this.logger.warn(
          `Routing circuit opened: ${error instanceof MapsUnavailableError ? error.message : 'unknown failure'}`,
        );
      }
      return null;
    }
  }

  // ─── the cache ────────────────────────────────────────────────────────────

  /**
   * Redis when there is Redis, an in-process map when there is not.
   *
   * Worth contrasting with the position store, which resolves its adapter from
   * configuration and whose in-process version production **refuses**. The
   * difference is what going without costs. A position store that does not
   * cross processes is a correctness problem — a family connected to one
   * instance would never see a report that arrived at another — so the wrong
   * one must not boot. A route cache that does not cross processes is only a
   * cost problem: every instance computes its own answer and every answer is
   * right. So this one degrades quietly instead of being refused, and the
   * fallback is a map rather than nothing so that the *behaviour* — one lookup
   * a minute per ride — is the same wherever it runs.
   */
  private async readRoute(rideId: string): Promise<CachedRoute | null> {
    if (!this.redis) return this.local.get(rideId, Date.now());

    try {
      const raw = await this.redis.get(keyFor(rideId));
      return raw ? parseRoute(raw) : null;
    } catch {
      // A cache that cannot be read is a cache miss. It must never be an
      // error a family sees on a map.
      return null;
    }
  }

  private async writeRoute(rideId: string, route: CachedRoute): Promise<void> {
    if (!this.redis) {
      this.local.set(rideId, route, Date.now());
      return;
    }

    try {
      // See CACHE_TTL_MS: both ends of that number are load bearing. It has to outlive the interval, or a failed vendor call would
      // find nothing to fall back to and the ETA would blank on every
      // refresh. It must not outlive it by much, because a route that keeps
      // being decayed without ever being recomputed counts down to one minute
      // and then sits there — and "arriving in 1 minute" for ten minutes is a
      // worse answer than an honest straight-line estimate. Five minutes is
      // where a vendor outage stops being a stale number and starts being a
      // fallback.
      await this.redis.set(keyFor(rideId), JSON.stringify(route), 'PX', CACHE_TTL_MS);
    } catch {
      // Same reasoning as the read. A cache write that fails costs a lookup.
    }
  }
}

function keyFor(rideId: string): string {
  return `eta:route:${rideId}`;
}

/**
 * The no-Redis cache.
 *
 * Bounded, because an unbounded map keyed by ride id is a slow leak with a
 * plausible excuse. The cap is far above any number of rides one instance
 * carries at once, so reaching it means something has gone wrong rather than
 * that the product got busy — and dropping the oldest is the right answer
 * either way.
 */
class LocalRouteCache {
  private static readonly CAPACITY = 5_000;
  private readonly entries = new Map<
    string,
    { route: CachedRoute; expiresAt: number }
  >();

  get(rideId: string, now: number): CachedRoute | null {
    const held = this.entries.get(rideId);
    if (!held) return null;

    // Expiry on read rather than on a timer: the answer has to be computed
    // against `now` anyway, and a route that expired while nobody asked was
    // never shown to anyone.
    if (held.expiresAt <= now) {
      this.entries.delete(rideId);
      return null;
    }
    return held.route;
  }

  set(rideId: string, route: CachedRoute, now: number): void {
    this.entries.set(rideId, { route, expiresAt: now + CACHE_TTL_MS });

    while (this.entries.size > LocalRouteCache.CAPACITY) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(rideId: string): void {
    this.entries.delete(rideId);
  }
}

/**
 * Defensive, because the value came from outside the process.
 *
 * A rolling deploy has two versions of this code reading the same keys, and a
 * shape that changed between them must read as a cache miss rather than as a
 * crash on a position report.
 */
function parseRoute(raw: string): CachedRoute | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CachedRoute>;
    if (
      typeof parsed.computedAt !== 'number' ||
      typeof parsed.durationMinutes !== 'number' ||
      (parsed.target !== 'pickup' && parsed.target !== 'destination') ||
      typeof parsed.from?.latitude !== 'number' ||
      typeof parsed.from?.longitude !== 'number'
    ) {
      return null;
    }

    return {
      computedAt: parsed.computedAt,
      durationMinutes: parsed.durationMinutes,
      from: { latitude: parsed.from.latitude, longitude: parsed.from.longitude },
      target: parsed.target,
    };
  } catch {
    return null;
  }
}
