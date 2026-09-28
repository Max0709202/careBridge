/**
 * Samples position for the ride in hand and gets it to the server. A port of
 * lib/services/location_service.dart, wired the same way: when to sample
 * ([cadenceFor]), what to do with a fix that cannot be sent ([LocationQueue]),
 * and where fixes come from ([PositionSource]).
 *
 * Two differences a browser forces:
 *
 * - **Cadence is applied to what is kept, not to the radio.** A page cannot
 *   ask the browser for a rate, so fixes arriving faster than the rule allows
 *   are simply not queued. The traffic and the server's load follow the rule;
 *   the GPS cost is the browser's.
 * - **A failed flush is retried on a timer and on `online`**, not only on the
 *   next fix: a browser delivers nothing for a car that is not moving, and a
 *   backlog must not wait for the car to set off again.
 *
 * It stops when the ride stops. Location is collectable only in states that
 * permit it; the server enforces that on arrival and this mirrors it.
 */
import { LocationQueue } from '../data/locationQueue';
import { batteryPressure, cadenceFor, type BatteryPressure } from '../domain/locationCadence';
import { jobSharesLocation, type Fix, type Job } from '../domain/models';
import type { RideStatus } from '../domain/rideStatus';
import type { BatterySource, LocationAccess, PositionSource, ScreenKeeper } from './positionSource';

export interface SharingState {
  /** The ride being followed, or null when nothing is being shared. */
  rideId: string | null;
  access: LocationAccess;
  /** Fixes waiting for signal — the only visible sign of a dead zone. */
  queued: number;
  lastSentAt: Date | null;
  /** The interval the rule currently asks for, so a battery back-off is visible. */
  cadenceMs: number | null;
  /** Whether the screen is being kept awake. */
  keptAwake: boolean;
}

export const idleSharing: SharingState = {
  rideId: null,
  access: 'granted',
  queued: 0,
  lastSentAt: null,
  cadenceMs: null,
  keptAwake: false,
};

export interface FlushTarget {
  flush(rideId: string, fixes: readonly Fix[]): Promise<unknown>;
}

/** Allowance for the jitter in when a browser delivers a fix. */
const CADENCE_SLACK_MS = 500;
const RETRY_MS = 15_000;

export class LocationService {
  private state: SharingState = idleSharing;
  private readonly listeners = new Set<() => void>();

  private stopWatching: (() => void) | null = null;
  private rideId: string | null = null;
  private status: RideStatus = 'driverEnRoute';
  private pressure: BatteryPressure = 'none';
  private cadenceMs: number | null = null;
  private lastKept: Fix | null = null;
  private lastRaw: Fix | null = null;
  private speed: number | null = null;
  private lastSentAt: Date | null = null;
  private access: LocationAccess = 'granted';
  private keptAwake = false;
  private flushing = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: {
      api: FlushTarget;
      positions: PositionSource;
      battery: BatterySource;
      screen?: ScreenKeeper;
      queue?: LocationQueue;
      /** The server's own cap on one batch. */
      batchSize?: number;
    },
    private readonly queue: LocationQueue = deps.queue ?? new LocationQueue(),
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  getState = (): SharingState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Follows [job], or stops if it is null or no longer shareable. Called on
   * every refresh of the work list, so it is idempotent: the same ride in the
   * same phase changes nothing.
   */
  async follow(job: Job | null): Promise<void> {
    if (!job || !jobSharesLocation(job)) {
      this.stop();
      return;
    }

    if (this.rideId !== null && this.rideId !== job.id) {
      // A different ride. The old queue belongs to a journey that is over.
      this.queue.clear();
      this.lastRaw = null;
      this.speed = null;
    }
    if (this.rideId !== job.id || this.status !== job.status) {
      // The first fix after a phase change is taken at once: a driver who has
      // just tapped "I have arrived" should not wait for the map to agree.
      this.lastKept = null;
    }
    this.rideId = job.id;
    this.status = job.status;

    const reading = await this.deps.battery.read();
    // Stopped, or moved to another ride, while the battery was being read.
    if (this.rideId !== job.id) return;
    this.pressure = batteryPressure(reading.percent, reading.charging);
    this.cadenceMs = cadenceFor({ status: job.status, speedMetersPerSecond: this.speed, battery: this.pressure });
    if (this.cadenceMs === null) {
      this.stop();
      return;
    }

    if (!this.stopWatching) {
      this.access = await this.deps.positions.ensureAccess();
      if (this.access === 'blocked' || this.access === 'unsupported') {
        this.publish();
        return;
      }
      // follow() may have been overtaken while awaiting; only one watch.
      if (!this.stopWatching && this.rideId === job.id) {
        this.stopWatching = this.deps.positions.watch(this.onFix, this.onAccess);
      }
    }

    this.keptAwake = (await this.deps.screen?.acquire()) ?? false;
    this.publish();
  }

  /**
   * Stops sampling and forgets what was queued. Once a ride leaves a sharing
   * state its positions are no longer collectable, so a farewell flush would
   * send exactly the readings the rule exists to stop.
   */
  stop(): void {
    if (this.rideId === null && this.stopWatching === null && this.access === 'granted') return;
    this.stopWatching?.();
    this.stopWatching = null;
    this.deps.screen?.release();
    this.keptAwake = false;
    this.queue.clear();
    this.rideId = null;
    this.cadenceMs = null;
    this.lastKept = null;
    this.lastRaw = null;
    this.speed = null;
    this.access = 'granted';
    this.clearRetry();
    this.publish();
  }

  dispose(): void {
    this.stop();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  private onAccess = (access: LocationAccess): void => {
    if (access === this.access) return;
    this.access = access;
    this.publish();
  };

  private onFix = (fix: Fix): void => {
    const rideId = this.rideId;
    if (rideId === null) return;

    // Speed from the fix when the browser reports it (most phones do while
    // moving); otherwise from the distance since the last one.
    this.speed = fix.speedMetersPerSecond ?? derivedSpeed(this.lastRaw, fix);
    this.lastRaw = fix;

    this.cadenceMs = cadenceFor({ status: this.status, speedMetersPerSecond: this.speed, battery: this.pressure });
    if (this.cadenceMs === null) return;

    const last = this.lastKept;
    if (last && fix.capturedAt.getTime() - last.capturedAt.getTime() < this.cadenceMs - CADENCE_SLACK_MS) {
      return;
    }
    this.lastKept = fix;
    this.queue.add(fix);
    this.publish();
    void this.flush(rideId);
  };

  private async flush(rideId: string): Promise<void> {
    if (this.flushing || this.queue.isEmpty) return;
    this.flushing = true;
    this.clearRetry();
    try {
      const batch = this.queue.peek(this.deps.batchSize ?? 240, new Date());
      if (batch.length === 0) return;
      await this.deps.api.flush(rideId, batch);
      // A ride that changed while the request was out must not have the new
      // ride's queue trimmed by the old one's reply.
      if (this.rideId === rideId) {
        this.queue.commit(batch);
        this.lastSentAt = new Date();
      }
    } catch {
      // Kept. Tried again on the next fix, on reconnecting, or on the timer.
      this.scheduleRetry();
    } finally {
      this.flushing = false;
      this.publish();
    }
    // A long backlog drains in several requests rather than waiting for fixes.
    if (this.rideId === rideId && !this.queue.isEmpty && this.retry === null) void this.flush(rideId);
  }

  private scheduleRetry(): void {
    if (this.retry !== null) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.rideId !== null) void this.flush(this.rideId);
    }, RETRY_MS);
  }

  private clearRetry(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
  }

  private onOnline = (): void => {
    if (this.rideId !== null) void this.flush(this.rideId);
  };

  /** A wake lock is dropped whenever the page is hidden; take it back on return. */
  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible' || this.rideId === null || !this.deps.screen) return;
    void this.deps.screen.acquire().then((kept) => {
      this.keptAwake = kept;
      this.publish();
    });
  };

  private publish(): void {
    this.state = {
      rideId: this.rideId,
      access: this.access,
      queued: this.queue.length,
      lastSentAt: this.lastSentAt,
      cadenceMs: this.cadenceMs,
      keptAwake: this.keptAwake,
    };
    for (const listener of this.listeners) listener();
  }
}

/** Metres per second between two fixes, or null when it cannot be told. */
export function derivedSpeed(from: Fix | null, to: Fix): number | null {
  if (!from) return null;
  const seconds = (to.capturedAt.getTime() - from.capturedAt.getTime()) / 1000;
  if (seconds <= 0) return null;
  return distanceMeters(from, to) / seconds;
}

function distanceMeters(a: Fix, b: Fix): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
