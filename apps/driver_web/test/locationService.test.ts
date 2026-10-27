import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jobFromWire } from '../src/api/codec';
import { Cadence } from '../src/domain/locationCadence';
import type { Fix, Job } from '../src/domain/models';
import { LocationService } from '../src/services/locationService';
import type { LocationAccess, PositionSource } from '../src/services/positionSource';
import { ride } from './support/fixtures';

class FakePositions implements PositionSource {
  access: LocationAccess = 'granted';
  watching = 0;
  private onFix: ((fix: Fix) => void) | null = null;

  async ensureAccess() {
    return this.access;
  }

  watch(onFix: (fix: Fix) => void) {
    this.watching++;
    this.onFix = onFix;
    return () => {
      this.watching--;
      this.onFix = null;
    };
  }

  emit(at: Date, speed: number | null = 10) {
    this.onFix?.({
      latitude: 40.65,
      longitude: -73.95,
      capturedAt: at,
      accuracyMeters: 8,
      speedMetersPerSecond: speed,
    });
  }
}

function setup() {
  const positions = new FakePositions();
  const sent: { rideId: string; count: number }[] = [];
  const api = {
    online: true,
    async flush(rideId: string, fixes: readonly Fix[]) {
      if (!this.online) throw new Error('offline');
      sent.push({ rideId, count: fixes.length });
    },
  };
  const service = new LocationService({
    api,
    positions,
    battery: { read: async () => ({ percent: 80, charging: false }) },
  });
  return { positions, api, sent, service };
}

const job = (status: Job['status'], id = 'ride-1') =>
  jobFromWire(ride({ id, status }))!;
const start = Date.now();
const at = (s: number) => new Date(start + s * 1000);
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

describe('following a ride', () => {
  it('asks for the cadence the rules chose, and sends what it samples', async () => {
    const { positions, sent, service } = setup();
    await service.follow(job('driverEnRoute'));
    expect(service.getState().cadenceMs).toBe(Cadence.approaching);
    positions.emit(at(0));
    await settle();
    expect(sent).toEqual([{ rideId: 'ride-1', count: 1 }]);
  });

  it('keeps no more than the cadence allows', async () => {
    const { positions, sent, service } = setup();
    await service.follow(job('inProgress'));
    positions.emit(at(0));
    positions.emit(at(3)); // inside the 10 s driving cadence
    positions.emit(at(10));
    await settle();
    expect(sent.reduce((n, s) => n + s.count, 0)).toBe(2);
  });

  it('will not sample without permission, and says so', async () => {
    const { positions, service } = setup();
    positions.access = 'blocked';
    await service.follow(job('driverEnRoute'));
    expect(positions.watching).toBe(0);
    expect(service.getState().access).toBe('blocked');
  });

  it('is idempotent across polls', async () => {
    const { positions, service } = setup();
    await service.follow(job('driverEnRoute'));
    await service.follow(job('driverEnRoute'));
    expect(positions.watching).toBe(1);
  });
});

describe('a dead zone', () => {
  it('keeps the fixes, and sends the backlog when signal returns', async () => {
    const { positions, api, sent, service } = setup();
    await service.follow(job('inProgress'));
    api.online = false;
    positions.emit(at(0));
    await settle();
    positions.emit(at(10));
    await settle();
    expect(service.getState().queued).toBe(2);

    api.online = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sent).toEqual([{ rideId: 'ride-1', count: 2 }]);
    expect(service.getState().queued).toBe(0);
  });
});

describe('when the ride ends', () => {
  it('stops sampling and throws the queue away rather than flushing it', async () => {
    const { positions, api, sent, service } = setup();
    await service.follow(job('inProgress'));
    api.online = false;
    positions.emit(at(0));
    await settle();
    await service.follow(job('completed'));
    api.online = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(positions.watching).toBe(0);
    expect(sent).toEqual([]);
    expect(service.getState().rideId).toBeNull();
  });
});

describe('moving to a different ride', () => {
  it('does not send the last ride’s positions to the new one', async () => {
    const { positions, api, sent, service } = setup();
    await service.follow(job('inProgress', 'ride-1'));
    api.online = false;
    positions.emit(at(0));
    await settle();
    await service.follow(job('driverEnRoute', 'ride-2'));
    api.online = true;
    positions.emit(at(20));
    await settle();
    expect(sent).toEqual([{ rideId: 'ride-2', count: 1 }]);
  });
});
