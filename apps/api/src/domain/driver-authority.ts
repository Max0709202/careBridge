import { InvalidTransitionError } from '../common/errors';
import { RIDE_STATUSES, allowedRideTransitions, type RideStatus } from './ride-status';

/**
 * What a driver may do to a ride, as distinct from what the ride allows.
 *
 * `ride-status.ts` answers "is this move legal at all". This answers "is it
 * *this person's* move to make", and the two are deliberately separate
 * questions: every transition here is also legal in the state machine, but not
 * every legal transition belongs to the driver.
 *
 * Mirrored in apps/driver_app/lib/domain/driver_authority.dart, which uses it
 * to decide which button to show. As always, that copy advises and this one
 * decides.
 */

/**
 * The driver's sequence, in order.
 *
 * Two absences are the point of the list.
 *
 * **Cancellation is not here.** A driver who could cancel could dispose of a
 * ride they would rather not do, and the family would be told their transport
 * was called off — when what actually happened is that it needs somebody else.
 * The ride is still owed. Cancelling belongs to the family, who no longer want
 * it, and to the operator, who has decided it cannot be served.
 *
 * **`reassignmentRequired` is not here either**, for the mirror-image reason.
 * A driver who breaks down telephones dispatch, and a dispatcher hands the ride
 * on with a reason recorded against their name. Letting the driver do it
 * silently would make "why was this ride reassigned four times" unanswerable —
 * and it is the question that matters when a family asks why nobody came.
 */
export const DRIVER_TRANSITIONS: readonly RideStatus[] = [
  'driverAccepted',
  'driverEnRoute',
  'driverArrived',
  'passengerOnboard',
  'inProgress',
  'arrivedAtDestination',
  'completed',
  'noShow',
];

const DRIVER_MOVES = new Set<RideStatus>(DRIVER_TRANSITIONS);

/**
 * How long a driver waits at the kerb before a no-show may be declared.
 *
 * A no-show ends the ride, bills nobody, and tells a family their relative
 * did not come out. Declared thirty seconds after arriving it means something
 * quite different — it means the driver did not wait — and the two are
 * indistinguishable after the fact unless the clock is part of the rule.
 *
 * Five minutes is the shortest interval in which an eighty-year-old can
 * plausibly get from a sofa to a front door, which is the case the number
 * exists for rather than the impatient one.
 */
export const NO_SHOW_WAIT_MS = 5 * 60 * 1000;

/** Whether this status change is one the driver is entitled to make. */
export function isDriverTransition(to: RideStatus): boolean {
  return DRIVER_MOVES.has(to);
}

/**
 * What the driver may do next, given where the ride is.
 *
 * The intersection of "legal" and "theirs", computed rather than written down
 * a second time — a hand-maintained table here would be a second state machine
 * to keep in step, and the one that drifts is always the one used to decide
 * which button to draw.
 */
export function driverMovesFrom(from: RideStatus): readonly RideStatus[] {
  return allowedRideTransitions(from).filter(isDriverTransition);
}

/**
 * Whether the wait at the kerb has been long enough to call it a no-show.
 *
 * `arrivedAt` is null when the ride has no recorded arrival, which is not a
 * state a no-show can be declared from at all — answering false is the safe
 * reading of "we have no evidence anybody waited".
 */
export function canDeclareNoShow(arrivedAt: Date | null, now: Date): boolean {
  if (!arrivedAt) return false;
  return now.getTime() - arrivedAt.getTime() >= NO_SHOW_WAIT_MS;
}

/** How much longer, in whole seconds, before a no-show may be declared. */
export function noShowWaitRemainingSeconds(arrivedAt: Date | null, now: Date): number {
  if (!arrivedAt) return Math.ceil(NO_SHOW_WAIT_MS / 1000);
  const remaining = NO_SHOW_WAIT_MS - (now.getTime() - arrivedAt.getTime());
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * Throws unless the driver may make this move from this state.
 *
 * Raises `InvalidTransitionError` for a move that is not theirs, the same
 * error a plainly illegal transition raises — a driver probing the API learns
 * only that the change is unavailable, not that it exists and belongs to
 * somebody else.
 */
export function assertDriverTransition(from: RideStatus, to: RideStatus): void {
  if (!driverMovesFrom(from).includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * The statuses that put a ride on a driver's list of work.
 *
 * Derived rather than written down: a ride is the driver's while there is
 * something for them to do with it. That definition gets two awkward cases
 * right for free. A **terminal** ride leaves the list, and with it the
 * passenger's address and telephone number. So does a ride in
 * `reassignmentRequired` — the row still names this driver until dispatch
 * hands it on, and for those moments it is emphatically not their job any
 * more.
 */
export const DRIVER_WORK_STATUSES: readonly RideStatus[] = RIDE_STATUSES.filter(
  (status) => driverMovesFrom(status).length > 0,
);
