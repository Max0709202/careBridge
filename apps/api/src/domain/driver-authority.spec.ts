import {
  DRIVER_TRANSITIONS,
  DRIVER_WORK_STATUSES,
  NO_SHOW_WAIT_MS,
  assertDriverTransition,
  canDeclareNoShow,
  driverMovesFrom,
  isDriverTransition,
  noShowWaitRemainingSeconds,
} from './driver-authority';
import { InvalidTransitionError } from '../common/errors';
import { RIDE_STATUSES, allowedRideTransitions } from './ride-status';

/**
 * What belongs to the driver.
 *
 * The tests worth reading are the ones about what does *not*: a driver who can
 * cancel can dispose of a ride, and a driver who can declare a no-show the
 * moment they arrive has an excuse rather than an outcome.
 */

describe('the driver’s share of the state machine', () => {
  it('never claims a move the ride itself forbids', () => {
    // The list is an intersection, so this is the property that keeps it
    // honest: adding a status here that the machine does not allow would
    // produce a button that always fails.
    for (const from of RIDE_STATUSES) {
      const legal = allowedRideTransitions(from);
      for (const move of driverMovesFrom(from)) {
        expect(legal).toContain(move);
      }
    }
  });

  it('leaves cancellation to the family and the operator', () => {
    // Cancellable from almost everywhere — and from nowhere by the driver. A
    // ride the driver cannot do still has to happen; telling the family it was
    // called off is a different and false statement.
    for (const from of RIDE_STATUSES) {
      expect(driverMovesFrom(from)).not.toContain('canceled');
    }
    expect(isDriverTransition('canceled')).toBe(false);
  });

  it('leaves reassignment to dispatch', () => {
    for (const from of RIDE_STATUSES) {
      expect(driverMovesFrom(from)).not.toContain('reassignmentRequired');
    }
  });

  it('leaves assignment to dispatch', () => {
    // `awaitingAssignment -> assigned` is legal, and it is the dispatcher
    // deciding who drives. A driver who could make it would be handing
    // themselves work.
    expect(driverMovesFrom('awaitingAssignment')).toEqual([]);
    expect(driverMovesFrom('reassignmentRequired')).toEqual([]);
  });

  it('walks the whole trip, one step at a time', () => {
    expect(driverMovesFrom('assigned')).toEqual(['driverAccepted']);
    expect(driverMovesFrom('driverAccepted')).toEqual(['driverEnRoute']);
    expect(driverMovesFrom('driverEnRoute')).toEqual(['driverArrived']);
    expect(driverMovesFrom('driverArrived')).toEqual(['passengerOnboard', 'noShow']);
    expect(driverMovesFrom('passengerOnboard')).toEqual(['inProgress']);
    expect(driverMovesFrom('inProgress')).toEqual(['arrivedAtDestination']);
    expect(driverMovesFrom('arrivedAtDestination')).toEqual(['completed']);
  });

  it('offers nothing once the ride is over', () => {
    expect(driverMovesFrom('completed')).toEqual([]);
    expect(driverMovesFrom('canceled')).toEqual([]);
    expect(driverMovesFrom('noShow')).toEqual([]);
  });

  it('offers nothing before a car is involved at all', () => {
    expect(driverMovesFrom('draft')).toEqual([]);
    expect(driverMovesFrom('requested')).toEqual([]);
  });

  it('lists exactly the statuses a driver can produce', () => {
    const reachable = new Set(RIDE_STATUSES.flatMap((s) => driverMovesFrom(s)));
    expect([...reachable].sort()).toEqual([...DRIVER_TRANSITIONS].sort());
  });
});

describe('asserting a driver’s move', () => {
  it('passes a legal one', () => {
    expect(() =>
      assertDriverTransition('driverEnRoute', 'driverArrived'),
    ).not.toThrow();
  });

  it('refuses a move that belongs to somebody else', () => {
    expect(() => assertDriverTransition('driverEnRoute', 'canceled')).toThrow(
      InvalidTransitionError,
    );
  });

  it('refuses one the machine forbids outright', () => {
    expect(() => assertDriverTransition('assigned', 'completed')).toThrow(
      InvalidTransitionError,
    );
  });

  it('says nothing about which of the two it was', () => {
    // A driver probing the API learns only that the change is unavailable. If
    // "not yours" read differently from "not possible", the error would map
    // out the operator's side of the product.
    const mine = (() => {
      try {
        assertDriverTransition('driverEnRoute', 'canceled');
      } catch (error) {
        return (error as Error).message;
      }
      return null;
    })();

    const impossible = (() => {
      try {
        assertDriverTransition('assigned', 'completed');
      } catch (error) {
        return (error as Error).message;
      }
      return null;
    })();

    expect(mine).toBe(impossible);
  });
});

describe('waiting at the kerb', () => {
  const arrived = new Date('2026-06-15T14:00:00Z');

  it('will not call a no-show the moment the car pulls up', () => {
    expect(canDeclareNoShow(arrived, new Date('2026-06-15T14:00:30Z'))).toBe(false);
  });

  it('allows it once the wait is served', () => {
    expect(
      canDeclareNoShow(arrived, new Date(arrived.getTime() + NO_SHOW_WAIT_MS)),
    ).toBe(true);
  });

  it('allows it well after', () => {
    expect(
      canDeclareNoShow(arrived, new Date(arrived.getTime() + NO_SHOW_WAIT_MS * 3)),
    ).toBe(true);
  });

  it('refuses when nobody ever recorded arriving', () => {
    // Not a state a no-show is reachable from anyway. Answering false is the
    // safe reading of "there is no evidence anybody waited".
    expect(canDeclareNoShow(null, new Date())).toBe(false);
  });

  it('counts down in whole seconds', () => {
    expect(noShowWaitRemainingSeconds(arrived, new Date('2026-06-15T14:01:00Z'))).toBe(
      240,
    );
    // Rounded up, so a screen never shows "0 seconds left" on a button that is
    // still disabled.
    expect(
      noShowWaitRemainingSeconds(arrived, new Date('2026-06-15T14:00:00.500Z')),
    ).toBe(300);
  });

  it('stops counting at zero rather than going negative', () => {
    expect(noShowWaitRemainingSeconds(arrived, new Date('2026-06-15T14:30:00Z'))).toBe(
      0,
    );
  });

  it('reports the full wait when there is no arrival to count from', () => {
    expect(noShowWaitRemainingSeconds(null, new Date())).toBe(NO_SHOW_WAIT_MS / 1000);
  });
});

describe('what counts as the driver’s work', () => {
  it('is every ride with a move left in it', () => {
    expect([...DRIVER_WORK_STATUSES]).toEqual([
      'assigned',
      'driverAccepted',
      'driverEnRoute',
      'driverArrived',
      'passengerOnboard',
      'inProgress',
      'arrivedAtDestination',
    ]);
  });

  it('drops a ride that has been handed back to dispatch', () => {
    // The row still names this driver until a new one is assigned. For those
    // moments the ride is not their job, and the passenger's address should
    // not be on their phone.
    expect(DRIVER_WORK_STATUSES).not.toContain('reassignmentRequired');
  });

  it('drops a finished ride', () => {
    for (const status of ['completed', 'canceled', 'noShow'] as const) {
      expect(DRIVER_WORK_STATUSES).not.toContain(status);
    }
  });
});
