import { ValidationError } from '../common/errors';
import { isAssignable, type DriverStatus } from './driver-status';
import type { RideStatus } from './ride-status';

/**
 * Which driver may take which ride, and which ride dispatch should look at
 * next. Pure: no database, no clock beyond the `now` it is handed.
 *
 * The MVP assigns manually — a dispatcher picks from a queue (R1). This file is
 * the part that must not be a matter of dispatcher judgement: the wheelchair
 * rule in particular, because the failure mode is a patient in a wheelchair
 * meeting a saloon car at the kerb, twenty minutes before a cardiology
 * appointment, with no second vehicle available. Auto-assignment, when it
 * lands, will rank candidates this function has already filtered.
 */

export interface DriverCandidate {
  driverId: string;
  displayName: string;
  status: DriverStatus;
  onShift: boolean;
  vehicleIsWheelchairAccessible: boolean;
  /** Rides already on this driver that have not reached a terminal state. */
  activeRideCount: number;
}

export interface RideDemand {
  rideId: string;
  status: RideStatus;
  scheduledPickupAt: Date;
  wheelchairRequired: boolean;
}

/** Statuses a dispatcher is being asked to act on. */
const AWAITING: readonly RideStatus[] = [
  'requested',
  'awaitingAssignment',
  'reassignmentRequired',
];

export function isAwaitingDispatch(status: RideStatus): boolean {
  return AWAITING.includes(status);
}

export type IneligibilityReason =
  | 'notApproved'
  | 'offShift'
  | 'noAccessibleVehicle'
  | 'alreadyOnARide';

export interface Eligibility {
  eligible: boolean;
  /** Every reason, not the first — a dispatcher needs the whole picture. */
  reasons: readonly IneligibilityReason[];
}

/**
 * Reasons rather than a boolean, because a dispatcher looking at an empty
 * candidate list has to know whether the answer is "nobody is on shift" or
 * "nobody has an accessible vehicle". Those need different phone calls.
 */
export function driverEligibility(
  driver: DriverCandidate,
  ride: Pick<RideDemand, 'wheelchairRequired'>,
): Eligibility {
  const reasons: IneligibilityReason[] = [];

  if (!isAssignable(driver.status)) reasons.push('notApproved');
  if (!driver.onShift) reasons.push('offShift');
  if (ride.wheelchairRequired && !driver.vehicleIsWheelchairAccessible) {
    reasons.push('noAccessibleVehicle');
  }
  // One passenger at a time. A driver cannot be two places at once, and a
  // dispatcher under pressure will double-book if nothing stops them.
  if (driver.activeRideCount > 0) reasons.push('alreadyOnARide');

  return { eligible: reasons.length === 0, reasons };
}

export function eligibleDrivers(
  drivers: readonly DriverCandidate[],
  ride: Pick<RideDemand, 'wheelchairRequired'>,
): readonly DriverCandidate[] {
  return drivers.filter((driver) => driverEligibility(driver, ride).eligible);
}

/**
 * Asserts an assignment is legal. Throws rather than returning false, so a
 * caller cannot forget to check the result.
 */
export function assertAssignable(
  driver: DriverCandidate,
  ride: Pick<RideDemand, 'wheelchairRequired'>,
): void {
  const { eligible, reasons } = driverEligibility(driver, ride);
  if (eligible) return;

  throw new ValidationError(
    EXPLANATIONS[reasons[0] as IneligibilityReason],
    'driverId',
  );
}

const EXPLANATIONS: Record<IneligibilityReason, string> = {
  notApproved: 'That driver has not been approved to carry passengers.',
  offShift: 'That driver is not on shift.',
  noAccessibleVehicle: 'This trip needs a wheelchair-accessible vehicle.',
  alreadyOnARide: 'That driver is already on a trip.',
};

export type DispatchUrgency = 'overdue' | 'imminent' | 'soon' | 'later';

/**
 * How close a ride is to needing a car, measured against its pickup time.
 *
 * The bands are what a queue is sorted and coloured by. `overdue` is its own
 * band rather than the top of `imminent` because a ride whose pickup time has
 * passed with nobody assigned is a *failure already in progress*, not an
 * urgent task — somebody is standing in a hallway waiting.
 */
export function dispatchUrgency(pickupAt: Date, now: Date): DispatchUrgency {
  const minutes = (pickupAt.getTime() - now.getTime()) / 60_000;

  if (minutes < 0) return 'overdue';
  if (minutes <= 30) return 'imminent';
  if (minutes <= 120) return 'soon';
  return 'later';
}

const URGENCY_ORDER: Record<DispatchUrgency, number> = {
  overdue: 0,
  imminent: 1,
  soon: 2,
  later: 3,
};

/**
 * The dispatch queue, ordered.
 *
 * Overdue first, then by pickup time. Deliberately *not* by when the request
 * arrived: a ride booked this morning for 4pm is not more urgent than one
 * booked five minutes ago for 2pm, and a first-in-first-out queue quietly
 * optimises for the dispatcher's sense of fairness rather than for the person
 * waiting.
 */
export function dispatchQueue<T extends RideDemand>(
  rides: readonly T[],
  now: Date,
): readonly (T & { urgency: DispatchUrgency })[] {
  return rides
    .filter((ride) => isAwaitingDispatch(ride.status))
    .map((ride) => ({ ...ride, urgency: dispatchUrgency(ride.scheduledPickupAt, now) }))
    .sort((a, b) => {
      const byUrgency = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      if (byUrgency !== 0) return byUrgency;
      return a.scheduledPickupAt.getTime() - b.scheduledPickupAt.getTime();
    });
}
