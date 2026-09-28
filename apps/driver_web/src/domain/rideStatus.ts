/**
 * The lifecycle of a ride, from the driver's side. A port of
 * lib/domain/ride_status.dart, carrying the driver's labels rather than the
 * family's: `driverArrived` is "Driver has arrived" to a daughter watching a
 * map, and "At the pickup" to the person in the car.
 */
export const rideStatuses = [
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
] as const;

export type RideStatus = (typeof rideStatuses)[number];

/** What the driver is being asked to confirm has happened. */
export function driverLabel(status: RideStatus): string {
  switch (status) {
    case 'assigned':
      return 'Offered to you';
    case 'driverAccepted':
      return 'Accepted';
    case 'driverEnRoute':
      return 'Driving to pickup';
    case 'driverArrived':
      return 'At the pickup';
    case 'passengerOnboard':
      return 'Passenger on board';
    case 'inProgress':
      return 'Driving to the clinic';
    case 'arrivedAtDestination':
      return 'At the clinic';
    case 'completed':
      return 'Finished';
    case 'noShow':
      return 'No show';
    case 'canceled':
      return 'Cancelled';
    case 'reassignmentRequired':
      return 'Returned to dispatch';
    case 'draft':
    case 'requested':
    case 'awaitingAssignment':
      return 'Not yet dispatched';
  }
}

/**
 * The words on the button that produces this state — the thing the driver
 * did, not a state name. "I have arrived" is answerable while stopping the car.
 */
export function actionLabel(status: RideStatus): string {
  switch (status) {
    case 'driverAccepted':
      return 'Accept this ride';
    case 'driverEnRoute':
      return 'Start driving';
    case 'driverArrived':
      return 'I have arrived';
    case 'passengerOnboard':
      return 'Passenger is in the car';
    case 'inProgress':
      return 'Set off for the clinic';
    case 'arrivedAtDestination':
      return 'We have arrived';
    case 'completed':
      return 'Finish the ride';
    case 'noShow':
      return 'Nobody came out';
    default:
      return 'Continue';
  }
}

/** Null for anything this build has never heard of. */
export function parseRideStatus(raw: unknown): RideStatus | null {
  return typeof raw === 'string' && (rideStatuses as readonly string[]).includes(raw)
    ? (raw as RideStatus)
    : null;
}
