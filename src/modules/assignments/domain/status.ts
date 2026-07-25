import { ConflictError } from "@/lib/errors";
import type { Role } from "@/modules/auth/domain/roles";

/**
 * Caregiver assignment lifecycle.
 *
 * An assignment is the caregiver's side of a service request: the offer, their
 * response, and the check-in/check-out record. It has its own state machine
 * because the two lifecycles genuinely diverge - a rejected assignment sends
 * the request back to CONFIRMED rather than cancelling it.
 *
 * See docs/STATUS-MACHINE.md for the diagram.
 */

export const ASSIGNMENT_STATUSES = [
  "OFFERED",
  "ACCEPTED",
  "REJECTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return typeof value === "string" && (ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  OFFERED: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
];

/**
 * The caregiver owns accept/reject and check-in/check-out. Only operations may
 * cancel an assignment, including re-assigning work away from a caregiver.
 */
const TRANSITION_ROLES: Record<string, readonly Role[]> = {
  "OFFERED->ACCEPTED": ["CAREGIVER"],
  "OFFERED->REJECTED": ["CAREGIVER"],
  "OFFERED->CANCELLED": ["OPERATIONS_ADMIN"],
  "ACCEPTED->IN_PROGRESS": ["CAREGIVER"],
  "ACCEPTED->CANCELLED": ["OPERATIONS_ADMIN"],
  "IN_PROGRESS->COMPLETED": ["CAREGIVER"],
  "IN_PROGRESS->CANCELLED": ["OPERATIONS_ADMIN"],
};

export function allowedAssignmentTransitions(from: AssignmentStatus): readonly AssignmentStatus[] {
  return ASSIGNMENT_TRANSITIONS[from];
}

export function isAssignmentTerminal(status: AssignmentStatus): boolean {
  return TERMINAL_ASSIGNMENT_STATUSES.includes(status);
}

export function canAssignmentTransition(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

export function canRoleAssignmentTransition(
  role: Role,
  from: AssignmentStatus,
  to: AssignmentStatus,
): boolean {
  if (!canAssignmentTransition(from, to)) return false;
  return (TRANSITION_ROLES[`${from}->${to}`] ?? []).includes(role);
}

export function assertAssignmentTransition(
  role: Role,
  from: AssignmentStatus,
  to: AssignmentStatus,
): void {
  if (!canAssignmentTransition(from, to)) {
    throw new ConflictError(
      `This assignment cannot move from ${ASSIGNMENT_STATUS_LABELS[from]} to ${ASSIGNMENT_STATUS_LABELS[to]}.`,
      { from, to },
    );
  }
  if (!canRoleAssignmentTransition(role, from, to)) {
    throw new ConflictError("You do not have permission to make this change.", { from, to, role });
  }
}

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  OFFERED: "Offered",
  ACCEPTED: "Accepted",
  REJECTED: "Declined",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
