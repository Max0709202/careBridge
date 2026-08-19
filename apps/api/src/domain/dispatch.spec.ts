import {
  assertAssignable,
  dispatchQueue,
  dispatchUrgency,
  driverEligibility,
  eligibleDrivers,
  isAwaitingDispatch,
  type DriverCandidate,
  type RideDemand,
} from './dispatch';
import { RIDE_STATUSES, type RideStatus } from './ride-status';
import { ValidationError } from '../common/errors';

const NOW = new Date('2026-06-15T12:00:00Z');

function driver(overrides: Partial<DriverCandidate> = {}): DriverCandidate {
  return {
    driverId: 'drv-1',
    displayName: 'Marcus T.',
    status: 'approved',
    onShift: true,
    vehicleIsWheelchairAccessible: false,
    activeRideCount: 0,
    ...overrides,
  };
}

function ride(overrides: Partial<RideDemand> = {}): RideDemand {
  return {
    rideId: 'ride-1',
    status: 'awaitingAssignment',
    scheduledPickupAt: new Date('2026-06-15T14:00:00Z'),
    wheelchairRequired: false,
    ...overrides,
  };
}

describe('which rides a dispatcher is being asked to act on', () => {
  it('is the three statuses with nobody driving yet', () => {
    const awaiting = RIDE_STATUSES.filter(isAwaitingDispatch);
    expect(awaiting).toEqual<RideStatus[]>([
      'requested',
      'awaitingAssignment',
      'reassignmentRequired',
    ]);
  });

  it('excludes a ride already under way and one already finished', () => {
    expect(isAwaitingDispatch('driverEnRoute')).toBe(false);
    expect(isAwaitingDispatch('completed')).toBe(false);
    expect(isAwaitingDispatch('draft')).toBe(false);
  });
});

describe('who may take a ride', () => {
  it('accepts an approved driver on shift with a free vehicle', () => {
    expect(driverEligibility(driver(), ride()).eligible).toBe(true);
  });

  it('refuses a driver the operator has not approved', () => {
    for (const status of [
      'invited',
      'pendingApproval',
      'suspended',
      'offboarded',
    ] as const) {
      const result = driverEligibility(driver({ status }), ride());
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('notApproved');
    }
  });

  it('refuses a saloon car for a wheelchair trip', () => {
    // The failure this prevents is a patient in a wheelchair meeting the wrong
    // vehicle at the kerb, twenty minutes before an appointment.
    const result = driverEligibility(
      driver({ vehicleIsWheelchairAccessible: false }),
      ride({ wheelchairRequired: true }),
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('noAccessibleVehicle');

    expect(
      driverEligibility(
        driver({ vehicleIsWheelchairAccessible: true }),
        ride({ wheelchairRequired: true }),
      ).eligible,
    ).toBe(true);
  });

  it('refuses a driver who is off shift or already carrying somebody', () => {
    expect(driverEligibility(driver({ onShift: false }), ride()).reasons).toContain(
      'offShift',
    );
    expect(driverEligibility(driver({ activeRideCount: 1 }), ride()).reasons).toContain(
      'alreadyOnARide',
    );
  });

  it('reports every reason, not the first', () => {
    // A dispatcher looking at an empty candidate list has to know whether the
    // answer is "nobody is on shift" or "nobody has an accessible vehicle".
    // Those need different phone calls.
    const result = driverEligibility(
      driver({ status: 'suspended', onShift: false, activeRideCount: 2 }),
      ride({ wheelchairRequired: true }),
    );

    expect(result.reasons).toEqual([
      'notApproved',
      'offShift',
      'noAccessibleVehicle',
      'alreadyOnARide',
    ]);
  });

  it('filters a roster down to the drivers who can actually go', () => {
    const roster = [
      driver({ driverId: 'a' }),
      driver({ driverId: 'b', onShift: false }),
      driver({ driverId: 'c', vehicleIsWheelchairAccessible: true }),
    ];

    expect(eligibleDrivers(roster, ride()).map((d) => d.driverId)).toEqual(['a', 'c']);
    expect(
      eligibleDrivers(roster, ride({ wheelchairRequired: true })).map(
        (d) => d.driverId,
      ),
    ).toEqual(['c']);
  });

  it('throws rather than returning a boolean a caller can forget to read', () => {
    expect(() => assertAssignable(driver(), ride())).not.toThrow();
    expect(() => assertAssignable(driver({ onShift: false }), ride())).toThrow(
      ValidationError,
    );

    try {
      assertAssignable(
        driver({ vehicleIsWheelchairAccessible: false }),
        ride({ wheelchairRequired: true }),
      );
      throw new Error('unreachable');
    } catch (error) {
      expect((error as ValidationError).message).toContain('wheelchair-accessible');
    }
  });
});

describe('the queue a dispatcher works down', () => {
  it('separates a failure already in progress from an urgent task', () => {
    // A pickup time that has passed with nobody assigned means somebody is
    // standing in a hallway waiting. That is not the top of "imminent".
    expect(dispatchUrgency(new Date('2026-06-15T11:59:00Z'), NOW)).toBe('overdue');
    expect(dispatchUrgency(new Date('2026-06-15T12:30:00Z'), NOW)).toBe('imminent');
    expect(dispatchUrgency(new Date('2026-06-15T14:00:00Z'), NOW)).toBe('soon');
    expect(dispatchUrgency(new Date('2026-06-15T18:00:00Z'), NOW)).toBe('later');
  });

  it('orders by when the car is needed, not by when the request arrived', () => {
    // First-in-first-out optimises for the dispatcher's sense of fairness
    // rather than for the person waiting.
    const queue = dispatchQueue(
      [
        ride({
          rideId: 'booked-first-needed-late',
          scheduledPickupAt: new Date('2026-06-15T16:00:00Z'),
        }),
        ride({
          rideId: 'needed-now',
          scheduledPickupAt: new Date('2026-06-15T12:20:00Z'),
        }),
        ride({
          rideId: 'overdue',
          scheduledPickupAt: new Date('2026-06-15T11:30:00Z'),
        }),
      ],
      NOW,
    );

    expect(queue.map((r) => r.rideId)).toEqual([
      'overdue',
      'needed-now',
      'booked-first-needed-late',
    ]);
    expect(queue[0]?.urgency).toBe('overdue');
  });

  it('breaks a tie within a band by pickup time', () => {
    // Two rides in the same urgency band still have an order, and it is the
    // one the passengers experience: whoever is collected first.
    const queue = dispatchQueue(
      [
        ride({ rideId: 'later', scheduledPickupAt: new Date('2026-06-15T13:50:00Z') }),
        ride({
          rideId: 'earlier',
          scheduledPickupAt: new Date('2026-06-15T13:10:00Z'),
        }),
      ],
      NOW,
    );

    expect(queue.map((r) => r.rideId)).toEqual(['earlier', 'later']);
    expect(queue.every((r) => r.urgency === 'soon')).toBe(true);
  });

  it('leaves out rides nobody is waiting on a decision for', () => {
    const queue = dispatchQueue(
      [
        ride({ rideId: 'live', status: 'inProgress' }),
        ride({ rideId: 'done', status: 'completed' }),
        ride({ rideId: 'dropped', status: 'reassignmentRequired' }),
      ],
      NOW,
    );

    expect(queue.map((r) => r.rideId)).toEqual(['dropped']);
  });

  it('is empty rather than undefined when there is nothing to do', () => {
    expect(dispatchQueue([], NOW)).toEqual([]);
  });
});
