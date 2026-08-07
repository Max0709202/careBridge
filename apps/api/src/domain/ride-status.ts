import { InvalidTransitionError } from '../common/errors';

/**
 * The lifecycle of a single ride leg. Mirrors lib/domain/ride_status.dart —
 * the client keeps its copy so it can disable controls, but **this** one is
 * authoritative. A client cannot be trusted with a state machine.
 *
 * `delayed` is deliberately not a member. A driver stuck in traffic on the way
 * to pickup is still `driverEnRoute`; making delay a status would lose the
 * state it has to return to. Delay is a flag on the ride plus a RideEvent.
 */
export type RideStatus =
  | 'draft'
  | 'requested'
  | 'awaitingAssignment'
  | 'assigned'
  | 'driverAccepted'
  | 'driverEnRoute'
  | 'driverArrived'
  | 'passengerOnboard'
  | 'inProgress'
  | 'arrivedAtDestination'
  | 'completed'
  | 'canceled'
  | 'noShow'
  | 'reassignmentRequired';

export const RIDE_STATUSES: readonly RideStatus[] = [
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
  'canceled',
  'noShow',
  'reassignmentRequired',
];

const TERMINAL = new Set<RideStatus>(['completed', 'canceled', 'noShow']);

/**
 * Whether the driver app may share location and the family app may show it.
 *
 * The single definition of "tracking is legal right now". Re-checked on every
 * inbound location point. Tracking begins when the driver sets off and ends the
 * moment the ride reaches a terminal state.
 */
const LOCATION_SHARING = new Set<RideStatus>([
  'driverEnRoute',
  'driverArrived',
  'passengerOnboard',
  'inProgress',
  'arrivedAtDestination',
]);

const PASSENGER_ONBOARD = new Set<RideStatus>(['passengerOnboard', 'inProgress']);

export function isTerminalRideStatus(status: RideStatus): boolean {
  return TERMINAL.has(status);
}

export function allowsLocationSharing(status: RideStatus): boolean {
  return LOCATION_SHARING.has(status);
}

export function passengerIsOnboard(status: RideStatus): boolean {
  return PASSENGER_ONBOARD.has(status);
}

/**
 * Allowed transitions. Anything not listed here is rejected.
 *
 * Cancellation is permitted from every state where the ride is still happening
 * — including after pickup, because the reasons for stopping one are rarely
 * convenient. The single exception is `arrivedAtDestination`: the passenger has
 * already been delivered, so there is nothing left to call off and the only
 * move is to complete.
 */
const ALLOWED: Record<RideStatus, readonly RideStatus[]> = {
  draft: ['requested', 'canceled'],
  requested: ['awaitingAssignment', 'canceled'],
  awaitingAssignment: ['assigned', 'reassignmentRequired', 'canceled'],
  assigned: ['driverAccepted', 'reassignmentRequired', 'canceled'],
  driverAccepted: ['driverEnRoute', 'reassignmentRequired', 'canceled'],
  driverEnRoute: ['driverArrived', 'reassignmentRequired', 'canceled'],
  driverArrived: ['passengerOnboard', 'noShow', 'canceled'],
  passengerOnboard: ['inProgress', 'canceled'],
  inProgress: ['arrivedAtDestination', 'canceled'],
  arrivedAtDestination: ['completed'],
  reassignmentRequired: ['assigned', 'canceled'],
  completed: [],
  canceled: [],
  noShow: [],
};

export function canTransitionRide(from: RideStatus, to: RideStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function allowedRideTransitions(from: RideStatus): readonly RideStatus[] {
  return ALLOWED[from] ?? [];
}

/** Throws unless the transition is legal. Every status change funnels here. */
export function assertRideTransition(from: RideStatus, to: RideStatus): void {
  if (!canTransitionRide(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
