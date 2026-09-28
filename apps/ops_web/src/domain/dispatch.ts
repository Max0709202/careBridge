/**
 * The dispatch rules, as the console renders them. A port of
 * apps/ops_console/lib/domain/dispatch.dart, which mirrors
 * apps/api/src/domain/dispatch.ts and driver-status.ts.
 *
 * This copy **decides nothing**. The server asserts every assignment; this file
 * exists so a dispatcher sees *why* a driver is unavailable before they click,
 * rather than after. Deleting it would change no outcome except which rows
 * look clickable.
 */

// ─── urgency ────────────────────────────────────────────────────────────────

export const DISPATCH_URGENCIES = ['overdue', 'imminent', 'soon', 'later'] as const;
export type DispatchUrgency = (typeof DISPATCH_URGENCIES)[number];

export function parseUrgency(value: unknown): DispatchUrgency | null {
  return (DISPATCH_URGENCIES as readonly unknown[]).includes(value) ? (value as DispatchUrgency) : null;
}

/**
 * What the band is called on screen. `overdue` is deliberately not "very
 * urgent": it is a failure already in progress — somebody is standing in a
 * hallway waiting.
 */
export const urgencyLabel: Record<DispatchUrgency, string> = {
  overdue: 'Overdue',
  imminent: 'Within 30 min',
  soon: 'Within 2 hours',
  later: 'Later',
};

/** Sort weight, matching `URGENCY_ORDER` on the server. */
export const urgencyOrder: Record<DispatchUrgency, number> = {
  overdue: 0,
  imminent: 1,
  soon: 2,
  later: 3,
};

export const isPressing = (urgency: DispatchUrgency) => urgency === 'overdue' || urgency === 'imminent';

// ─── ineligibility ──────────────────────────────────────────────────────────

/**
 * Why a driver cannot take a particular trip. Every reason is carried, never
 * just the first: "nobody is on shift" and "nobody has an accessible vehicle"
 * need different phone calls.
 */
export const INELIGIBILITY_REASONS = ['notApproved', 'offShift', 'noAccessibleVehicle', 'alreadyOnARide'] as const;
export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

export function parseReason(value: unknown): IneligibilityReason | null {
  return (INELIGIBILITY_REASONS as readonly unknown[]).includes(value) ? (value as IneligibilityReason) : null;
}

export const reasonLabel: Record<IneligibilityReason, string> = {
  notApproved: 'Not approved to carry passengers',
  offShift: 'Not on shift',
  noAccessibleVehicle: 'No wheelchair-accessible vehicle',
  alreadyOnARide: 'Already on a trip',
};

/**
 * What a dispatcher could actually do about it, where there is something.
 * `noAccessibleVehicle` has none on purpose: the answer is another vehicle, and
 * "assign anyway" is exactly what the server refuses.
 */
export const reasonRemedy: Record<IneligibilityReason, string | null> = {
  offShift: 'Put them on shift from the roster',
  notApproved: 'Approve them from the roster',
  alreadyOnARide: 'Wait for their current trip to finish',
  noAccessibleVehicle: null,
};

// ─── driver status ──────────────────────────────────────────────────────────

export const DRIVER_STATUSES = ['invited', 'pendingApproval', 'approved', 'suspended', 'offboarded'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export function parseDriverStatus(value: unknown): DriverStatus | null {
  return (DRIVER_STATUSES as readonly unknown[]).includes(value) ? (value as DriverStatus) : null;
}

export const driverStatusLabel: Record<DriverStatus, string> = {
  invited: 'Invited',
  pendingApproval: 'Awaiting approval',
  approved: 'Approved',
  suspended: 'Suspended',
  offboarded: 'Offboarded',
};

/** Only an approved driver may be assigned, and only they occupy a billable seat. */
export const isAssignable = (status: DriverStatus) => status === 'approved';
export const occupiesSeat = (status: DriverStatus) => status === 'approved';
export const isTerminal = (status: DriverStatus) => status === 'offboarded';

/**
 * The transitions the server's state machine allows. Note there is **no edge
 * from `invited` to `approved`**: approval is a decision about documents
 * somebody submitted.
 */
export const allowedDriverTransitions: Record<DriverStatus, readonly DriverStatus[]> = {
  invited: ['pendingApproval', 'offboarded'],
  pendingApproval: ['approved', 'suspended', 'offboarded'],
  approved: ['suspended', 'offboarded'],
  suspended: ['approved', 'offboarded'],
  offboarded: [],
};

export const nextStatusesFor = (from: DriverStatus): readonly DriverStatus[] => allowedDriverTransitions[from];

export const canTransitionDriver = (from: DriverStatus, to: DriverStatus) => nextStatusesFor(from).includes(to);

/**
 * Suspension and offboarding both end somebody's ability to earn, and a record
 * of one with no reason is unanswerable three months later. The server accepts
 * a reason on any transition; the console insists on one for these two.
 */
export const transitionNeedsReason = (to: DriverStatus) => to === 'suspended' || to === 'offboarded';

/** The verb, not the destination state: a button is named for what it does. */
export const transitionActionLabel: Record<DriverStatus, string> = {
  pendingApproval: 'Send for approval',
  approved: 'Approve',
  suspended: 'Suspend',
  offboarded: 'Offboard',
  invited: 'Invite',
};
