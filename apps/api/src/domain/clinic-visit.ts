import { ValidationError } from '../common/errors';
import type { RideStatus } from './ride-status';

/**
 * What a clinic may say about a visit, and when.
 *
 * A clinic knows two things nobody else in this system does: that the patient
 * actually came in, and that the visit is over. Both are worth having and
 * neither is free to accept unconditionally.
 *
 * **Checking in is not the same as the ride completing.** A completed ride
 * says a car reached an address. A check-in says somebody inside the building
 * saw the patient. The gap between them is precisely the case this product
 * exists for — an eighty-year-old dropped at the wrong entrance of a hospital
 * — so the two are recorded separately and the second is never inferred from
 * the first.
 *
 * **Ready-for-return dispatches a car.** That makes it the one clinic action
 * that spends money and moves a vehicle, so it is the one with real
 * preconditions.
 */

export type VisitStage =
  /** Booked. The patient has not arrived. */
  | 'expected'
  /** Somebody at the clinic confirmed they came in. */
  | 'checkedIn'
  /** The visit is over and a car has been asked for. */
  | 'readyForReturn'
  /** A car is on its way, or the patient is in it. */
  | 'returning'
  | 'finished';

export interface VisitState {
  checkedInAt: Date | null;
  readyForReturnAt: Date | null;
  /** The outbound leg, which is how "did they arrive" is corroborated. */
  outboundStatus: RideStatus | null;
  /** The return leg, when one was booked. */
  returnStatus: RideStatus | null;
}

/**
 * Statuses that mean a car is actually coming for the journey home.
 *
 * `draft` and `requested` are deliberately absent, and that is the distinction
 * the whole portal turns on. A round trip books **both** legs at once, so a
 * return ride exists from the moment the appointment is made — sitting at
 * `requested` with no time, waiting. Treating its existence as "a car is on
 * the way" would show every patient as already going home before they had
 * arrived.
 */
const RETURN_UNDERWAY = new Set<RideStatus>([
  'awaitingAssignment',
  'assigned',
  'driverAccepted',
  'driverEnRoute',
  'driverArrived',
  'passengerOnboard',
  'inProgress',
  'arrivedAtDestination',
  'reassignmentRequired',
]);

export function stageOf(visit: VisitState): VisitStage {
  if (visit.returnStatus === 'completed') return 'finished';
  // Checked before the clinic's own flag, so a return the **family**
  // dispatched still reads as a car on the way. A portal that only believed
  // its own button would show a patient as waiting while a car was outside.
  if (visit.returnStatus && RETURN_UNDERWAY.has(visit.returnStatus)) {
    return 'returning';
  }
  if (visit.readyForReturnAt) return 'readyForReturn';
  if (visit.checkedInAt) return 'checkedIn';
  return 'expected';
}

/**
 * Whether the clinic may confirm the patient has arrived.
 *
 * Deliberately permissive about the ride. A patient who took a taxi, or whose
 * daughter drove them, still walks through the door — and a portal that could
 * only check in people the platform carried would be a portal that is wrong
 * about half its waiting room.
 */
export function canCheckIn(visit: VisitState): boolean {
  return visit.checkedInAt === null;
}

export interface ReturnDispatchCheck {
  ok: boolean;
  /** Written for somebody at a reception desk, not for a log. */
  reason?: string;
}

/**
 * Whether a car may be sent for the journey home.
 *
 * The two refusals are the interesting part. Sending a car for somebody who
 * never arrived is a wasted journey and a confused driver; sending a second
 * one when a return is already under way is a second charge and a second car
 * at the kerb.
 */
export function canDispatchReturn(visit: VisitState): ReturnDispatchCheck {
  if (!visit.checkedInAt) {
    return {
      ok: false,
      reason:
        'Confirm the patient has arrived first — a car sent for somebody who never came in is a wasted journey.',
    };
  }
  if (visit.returnStatus === null) {
    return {
      ok: false,
      reason:
        'No return journey was booked with this appointment. The family can add one from their app.',
    };
  }
  if (visit.returnStatus === 'canceled') {
    return { ok: false, reason: 'The return journey was cancelled.' };
  }
  if (RETURN_UNDERWAY.has(visit.returnStatus)) {
    return { ok: false, reason: 'A car is already on the way.' };
  }
  return { ok: true };
}

export function assertCanDispatchReturn(visit: VisitState): void {
  const check = canDispatchReturn(visit);
  if (!check.ok) throw new ValidationError(check.reason ?? 'Not right now.');
}

/**
 * How long a patient has been waiting since the clinic said they were ready.
 *
 * Surfaced to the clinic rather than kept internal, because the person who
 * pressed the button is the person standing next to somebody in a coat by the
 * door, and "it has been forty minutes" is the fact that makes them telephone.
 */
export function waitingMinutes(visit: VisitState, now: Date): number | null {
  if (!visit.readyForReturnAt) return null;
  if (
    visit.returnStatus === 'passengerOnboard' ||
    visit.returnStatus === 'inProgress'
  ) {
    return null;
  }
  return Math.max(
    0,
    Math.floor((now.getTime() - visit.readyForReturnAt.getTime()) / 60_000),
  );
}

/**
 * The point at which a wait stops being ordinary.
 *
 * Twenty-five minutes: long enough that a busy afternoon does not trip it,
 * short enough that somebody in a coat by a door has not been forgotten.
 */
export const RETURN_WAIT_CONCERN_MINUTES = 25;

export function returnIsOverdue(visit: VisitState, now: Date): boolean {
  const waiting = waitingMinutes(visit, now);
  return waiting !== null && waiting >= RETURN_WAIT_CONCERN_MINUTES;
}
