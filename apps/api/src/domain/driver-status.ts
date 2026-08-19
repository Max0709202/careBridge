import { InvalidTransitionError } from '../common/errors';

/**
 * The lifecycle of a driver at a transport operator.
 *
 * Separate from `RideStatus` on purpose: one describes a journey, this
 * describes a person's standing with the company that dispatches them, and the
 * two change for entirely unrelated reasons. A driver being suspended
 * mid-shift must not be expressible as a ride transition.
 *
 * It is also the meter for the operator's subscription. A driver occupies a
 * **billable seat** exactly while they are `approved` — see `occupiesSeat`,
 * which is the single definition and is what the seat ledger is written from.
 * That coupling is deliberate: the alternative is a second boolean somebody has
 * to remember to keep in step, and an operator billed for drivers they
 * offboarded in March is the kind of error that ends a contract.
 */
export type DriverStatus =
  /** Created by the operator; has not yet supplied anything. */
  | 'invited'
  /** Documents submitted, awaiting an admin decision. */
  | 'pendingApproval'
  /** May be assigned rides. The only status that occupies a seat. */
  | 'approved'
  /** Temporarily stopped — an expired licence, an incident under review. */
  | 'suspended'
  /** Gone. Terminal, and the record stays so old rides still name a driver. */
  | 'offboarded';

export const DRIVER_STATUSES: readonly DriverStatus[] = [
  'invited',
  'pendingApproval',
  'approved',
  'suspended',
  'offboarded',
];

const ALLOWED_TRANSITIONS: Record<DriverStatus, readonly DriverStatus[]> = {
  invited: ['pendingApproval', 'offboarded'],
  // No edge straight to `approved`: approval is a decision about documents
  // somebody submitted, and an operator that can approve an empty file has an
  // onboarding control that does nothing.
  pendingApproval: ['approved', 'suspended', 'offboarded'],
  approved: ['suspended', 'offboarded'],
  suspended: ['approved', 'offboarded'],
  offboarded: [],
};

export function canTransitionDriver(from: DriverStatus, to: DriverStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertDriverTransition(from: DriverStatus, to: DriverStatus): void {
  if (!canTransitionDriver(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Whether this driver is one the operator is billed for.
 *
 * The single definition. `BillingService.recordSeatChange` counts the drivers
 * this returns true for, and nothing else decides it.
 */
export function occupiesSeat(status: DriverStatus): boolean {
  return status === 'approved';
}

/**
 * Whether a ride may be given to this driver *at all*.
 *
 * Distinct from "is on shift", which is a scheduling question and changes
 * several times a day. This one asks whether the company has said this person
 * may carry a passenger, and the answer must not depend on how busy dispatch
 * is.
 */
export function isAssignable(status: DriverStatus): boolean {
  return status === 'approved';
}

export function isTerminalDriverStatus(status: DriverStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
