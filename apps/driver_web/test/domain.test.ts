import { describe, expect, it } from 'vitest';

import { jobFromWire } from '../src/api/codec';
import { LocationQueue } from '../src/data/locationQueue';
import { driverMovesFrom, driverTransitions, sharesLocation } from '../src/domain/driverAuthority';
import { batteryPressure, Cadence, cadenceFor, staleAfterMs } from '../src/domain/locationCadence';
import { fixToJson, offersNoShow, primaryMove, type Fix } from '../src/domain/models';
import { actionLabel, driverLabel, rideStatuses } from '../src/domain/rideStatus';
import { ride } from './support/fixtures';

const fix = (secondsAgo = 0, now = new Date('2026-06-15T14:00:00Z')): Fix => ({
  latitude: 40.65,
  longitude: -73.95,
  capturedAt: new Date(now.getTime() - secondsAgo * 1000),
  accuracyMeters: 12,
  speedMetersPerSecond: null,
});

describe('what the driver may do', () => {
  it('walks the trip one step at a time', () => {
    expect(driverMovesFrom('assigned')).toEqual(['driverAccepted']);
    expect(driverMovesFrom('driverEnRoute')).toEqual(['driverArrived']);
    expect(driverMovesFrom('driverArrived')).toEqual(['passengerOnboard', 'noShow']);
    expect(driverMovesFrom('arrivedAtDestination')).toEqual(['completed']);
  });

  it('never offers to cancel or to hand the ride back', () => {
    for (const status of rideStatuses) {
      expect(driverMovesFrom(status)).not.toContain('canceled');
      expect(driverMovesFrom(status)).not.toContain('reassignmentRequired');
    }
  });

  it('offers nothing once the ride is over', () => {
    for (const status of ['completed', 'canceled', 'noShow', 'reassignmentRequired'] as const) {
      expect(driverMovesFrom(status)).toEqual([]);
    }
  });

  it('only ever offers moves the shared list names', () => {
    for (const status of rideStatuses) {
      for (const move of driverMovesFrom(status)) expect(driverTransitions).toContain(move);
    }
  });
});

describe('when location is shared', () => {
  it('starts when the driver sets off and stops when the ride ends', () => {
    expect(sharesLocation('driverAccepted')).toBe(false);
    expect(sharesLocation('driverEnRoute')).toBe(true);
    expect(sharesLocation('arrivedAtDestination')).toBe(true);
    expect(sharesLocation('completed')).toBe(false);
    expect(sharesLocation('reassignmentRequired')).toBe(false);
  });
});

describe('the words on the screen', () => {
  it('names the action, not the state', () => {
    expect(actionLabel('driverArrived')).toBe('I have arrived');
    expect(actionLabel('noShow')).toBe('Nobody came out');
  });

  it('has something to say about every state', () => {
    for (const status of rideStatuses) expect(driverLabel(status)).not.toBe('');
  });
});

describe('cadence', () => {
  it('says nothing to do before the driver sets off, or after the ride', () => {
    expect(cadenceFor({ status: 'driverAccepted' })).toBeNull();
    expect(cadenceFor({ status: 'completed', battery: 'critical' })).toBeNull();
  });

  it('samples fastest on the approach, and slows for a car that is not moving', () => {
    expect(cadenceFor({ status: 'driverEnRoute' })).toBe(Cadence.approaching);
    expect(cadenceFor({ status: 'driverEnRoute', speedMetersPerSecond: 0.2 })).toBe(Cadence.stopped);
    expect(cadenceFor({ status: 'inProgress', speedMetersPerSecond: 12 })).toBe(Cadence.driving);
  });

  it('idles at the kerb even when the fix reads as moving', () => {
    expect(cadenceFor({ status: 'driverArrived', speedMetersPerSecond: 3 })).toBe(Cadence.stopped);
  });

  it('keeps every ordinary cadence inside the stale bound', () => {
    for (const ms of [Cadence.approaching, Cadence.driving, Cadence.stopped, Cadence.lowBattery]) {
      expect(ms).toBeLessThan(staleAfterMs);
    }
  });

  it('backs off on battery, and lets charging outrank the percentage', () => {
    expect(cadenceFor({ status: 'driverEnRoute', battery: 'low' })).toBe(Cadence.lowBattery);
    expect(cadenceFor({ status: 'driverEnRoute', battery: 'critical' })).toBe(Cadence.criticalBattery);
    expect(batteryPressure(4, true)).toBe('none');
    expect(batteryPressure(null, false)).toBe('none');
    expect(batteryPressure(5, false)).toBe('critical');
    expect(batteryPressure(15, false)).toBe('low');
    expect(batteryPressure(16, false)).toBe('none');
  });
});

describe('the queue', () => {
  it('drops the oldest rather than refusing the newest, and says how many', () => {
    const queue = new LocationQueue(2);
    const [a, b, c] = [fix(3), fix(2), fix(1)];
    queue.add(a);
    queue.add(b);
    queue.add(c);
    expect(queue.peek(10, new Date('2026-06-15T14:00:00Z'))).toEqual([b, c]);
    expect(queue.dropped).toBe(1);
  });

  it('does not lose a batch the server never received, and drops only what was sent', () => {
    const queue = new LocationQueue();
    const now = new Date('2026-06-15T14:00:00Z');
    queue.add(fix(2));
    const batch = queue.peek(10, now);
    const late = fix(0);
    queue.add(late);
    expect(queue.length).toBe(2);
    queue.commit(batch);
    queue.commit(batch);
    expect(queue.peek(10, now)).toEqual([late]);
  });

  it('forgets anything the server would refuse as backlog', () => {
    const queue = new LocationQueue();
    queue.add(fix(7 * 3600));
    queue.add(fix(1));
    expect(queue.peek(10, new Date('2026-06-15T14:00:00Z'))).toHaveLength(1);
  });

  it('sends the position and nothing it could be second-guessed by', () => {
    expect(Object.keys(fixToJson({ ...fix(), speedMetersPerSecond: 9 })).sort()).toEqual([
      'accuracyMeters',
      'capturedAt',
      'latitude',
      'longitude',
    ]);
  });
});

describe('reading a ride off the wire', () => {
  it('carries everything needed to collect somebody', () => {
    const job = jobFromWire(ride())!;
    expect(job.passengerName).toBe('Margaret');
    expect(job.status).toBe('driverArrived');
    expect(primaryMove(job)).toBe('passengerOnboard');
    expect(offersNoShow(job)).toBe(true);
  });

  it('drops a transition this build has never heard of', () => {
    const job = jobFromWire(ride({ availableTransitions: ['passengerOnboard', 'teleport'] }))!;
    expect(job.availableTransitions).toEqual(['passengerOnboard']);
  });

  it('drops a ride whose status this build has never heard of', () => {
    expect(jobFromWire(ride({ status: 'hovering' as never }))).toBeNull();
  });
});
