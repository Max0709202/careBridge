import {
  allowedRideTransitions,
  allowsLocationSharing,
  assertRideTransition,
  canTransitionRide,
  isTerminalRideStatus,
  passengerIsOnboard,
  RIDE_STATUSES,
  type RideStatus,
} from './ride-status';
import { InvalidTransitionError } from '../common/errors';

describe('ride state machine', () => {
  it('runs the happy path from request to completion', () => {
    const journey: RideStatus[] = [
      'draft',
      'requested',
      'awaitingAssignment',
      'assigned',
      'driverAccepted',
      'driverEnRoute',
      'driverArrived',
      'passengerOnboard',
      'inProgress',
      'arrivedAtDestination',
      'completed',
    ];

    for (let i = 0; i < journey.length - 1; i += 1) {
      expect(canTransitionRide(journey[i]!, journey[i + 1]!)).toBe(true);
    }
  });

  it('rejects every transition that is not declared', () => {
    // Exhaustive rather than illustrative: a transition added to the map
    // without being thought about should fail a test, not ship.
    const legal = new Set<string>();
    for (const from of RIDE_STATUSES) {
      for (const to of allowedRideTransitions(from)) {
        legal.add(`${from}->${to}`);
      }
    }

    for (const from of RIDE_STATUSES) {
      for (const to of RIDE_STATUSES) {
        expect(canTransitionRide(from, to)).toBe(legal.has(`${from}->${to}`));
      }
    }
  });

  it('never allows a status to transition to itself', () => {
    for (const status of RIDE_STATUSES) {
      expect(canTransitionRide(status, status)).toBe(false);
    }
  });

  it('lets a ride be cancelled from every live state except after delivery', () => {
    // The reasons for stopping a ride are rarely convenient, so cancellation
    // stays available right through the journey. `arrivedAtDestination` is the
    // one exception: the passenger is already there, and the only move left is
    // to complete.
    const cancellable = RIDE_STATUSES.filter(
      (s) => !isTerminalRideStatus(s) && s !== 'arrivedAtDestination',
    );

    for (const status of cancellable) {
      expect(canTransitionRide(status, 'canceled')).toBe(true);
    }
    expect(canTransitionRide('arrivedAtDestination', 'canceled')).toBe(false);
    expect(allowedRideTransitions('arrivedAtDestination')).toEqual(['completed']);
  });

  it('treats terminal states as final', () => {
    for (const status of ['completed', 'canceled', 'noShow'] as RideStatus[]) {
      expect(isTerminalRideStatus(status)).toBe(true);
      expect(allowedRideTransitions(status)).toHaveLength(0);
    }
  });

  it('permits location sharing only while a trip is actually running', () => {
    const sharing = RIDE_STATUSES.filter(allowsLocationSharing);
    expect(sharing).toEqual([
      'driverEnRoute',
      'driverArrived',
      'passengerOnboard',
      'inProgress',
      'arrivedAtDestination',
    ]);

    // Nothing terminal may share a position — this is what stops a finished
    // ride rendering a marker.
    for (const status of RIDE_STATUSES.filter(isTerminalRideStatus)) {
      expect(allowsLocationSharing(status)).toBe(false);
    }

    // And nothing before the driver sets off.
    expect(allowsLocationSharing('requested')).toBe(false);
    expect(allowsLocationSharing('assigned')).toBe(false);
    expect(allowsLocationSharing('driverAccepted')).toBe(false);
  });

  it('knows when the passenger is physically in the vehicle', () => {
    expect(RIDE_STATUSES.filter(passengerIsOnboard)).toEqual([
      'passengerOnboard',
      'inProgress',
    ]);
  });

  it('allows reassignment from any state where a driver is committed', () => {
    for (const status of [
      'awaitingAssignment',
      'assigned',
      'driverAccepted',
      'driverEnRoute',
    ] as RideStatus[]) {
      expect(canTransitionRide(status, 'reassignmentRequired')).toBe(true);
    }
    expect(canTransitionRide('reassignmentRequired', 'assigned')).toBe(true);
  });

  it('allows a no-show only once the driver is actually at the door', () => {
    expect(canTransitionRide('driverArrived', 'noShow')).toBe(true);
    for (const status of RIDE_STATUSES.filter((s) => s !== 'driverArrived')) {
      expect(canTransitionRide(status, 'noShow')).toBe(false);
    }
  });

  it('throws on an illegal transition rather than writing it', () => {
    expect(() => assertRideTransition('requested', 'completed')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertRideTransition('completed', 'requested')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertRideTransition('requested', 'awaitingAssignment')).not.toThrow();
  });

  it('offers nothing and permits nothing from a status it does not recognise', () => {
    // The database can hand this build a status a newer one wrote. Both the
    // "what can I do next" list the app renders and the check the server makes
    // must read it as a dead end rather than as an empty allowlist meaning
    // "anything".
    const unknown = 'impounded' as RideStatus;
    expect(allowedRideTransitions(unknown)).toEqual([]);
    expect(canTransitionRide(unknown, 'completed')).toBe(false);
    expect(() => assertRideTransition(unknown, 'completed')).toThrow(
      InvalidTransitionError,
    );
  });

  it('has no `delayed` status, because delay is a flag', () => {
    // A driver stuck in traffic on the way to pickup is still driverEnRoute.
    // Modelling delay as a status would lose the state it must return to.
    expect(RIDE_STATUSES).not.toContain('delayed');
  });
});
