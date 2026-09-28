/**
 * What belongs to the driver, mirrored from
 * apps/api/src/domain/driver-authority.ts (via lib/domain/driver_authority.dart).
 *
 * This copy **advises**. It decides which button to draw; the server decides
 * whether the move happens. Cancellation and reassignment are absent on
 * purpose: they are not the driver's to make.
 */
import type { RideStatus } from './rideStatus';

export const driverTransitions: readonly RideStatus[] = [
  'driverAccepted',
  'driverEnRoute',
  'driverArrived',
  'passengerOnboard',
  'inProgress',
  'arrivedAtDestination',
  'completed',
  'noShow',
];

/**
 * How long a driver waits at the kerb before a no-show may be declared — the
 * shortest interval in which an eighty-year-old can plausibly get from a sofa
 * to a front door. The server enforces it; this copy lets the screen count down.
 */
export const noShowWaitSeconds = 5 * 60;

/** The moves that are legal *and* the driver's, given where the ride is. */
export function driverMovesFrom(from: RideStatus): RideStatus[] {
  switch (from) {
    case 'assigned':
      return ['driverAccepted'];
    case 'driverAccepted':
      return ['driverEnRoute'];
    case 'driverEnRoute':
      return ['driverArrived'];
    case 'driverArrived':
      return ['passengerOnboard', 'noShow'];
    case 'passengerOnboard':
      return ['inProgress'];
    case 'inProgress':
      return ['arrivedAtDestination'];
    case 'arrivedAtDestination':
      return ['completed'];
    default:
      return [];
  }
}

/**
 * Whether the device should be sampling location — the same rule the server's
 * write path enforces, so the app never collects readings the server would
 * refuse.
 */
export function sharesLocation(status: RideStatus): boolean {
  switch (status) {
    case 'driverEnRoute':
    case 'driverArrived':
    case 'passengerOnboard':
    case 'inProgress':
    case 'arrivedAtDestination':
      return true;
    default:
      return false;
  }
}
