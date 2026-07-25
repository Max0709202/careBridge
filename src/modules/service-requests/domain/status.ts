import { ConflictError } from "@/lib/errors";
import type { Role } from "@/modules/auth/domain/roles";

/**
 * Service request lifecycle.
 *
 * This is the single source of truth for which status changes are legal and
 * who may make them. Persistence layers, server actions and UI all consult it;
 * none of them may hand-roll a status comparison. The full diagram and the
 * reasoning behind each edge live in docs/STATUS-MACHINE.md.
 */

export const SERVICE_REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CONFIRMED",
  "CAREGIVER_ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export function isServiceRequestStatus(value: unknown): value is ServiceRequestStatus {
  return (
    typeof value === "string" && (SERVICE_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Allowed transitions.
 *
 * Notable edges:
 *  - CONFIRMED -> IN_PROGRESS skips CAREGIVER_ASSIGNED for transport-only
 *    requests, where no companion is needed.
 *  - CAREGIVER_ASSIGNED -> CONFIRMED is the un-assign path, used when a
 *    caregiver rejects an offer and the request returns to the queue.
 *  - COMPLETED and CANCELLED are terminal. Reopening is deliberately not
 *    supported; a new request is created instead, which keeps the audit trail
 *    of each service episode intact.
 */
export const SERVICE_REQUEST_TRANSITIONS: Record<
  ServiceRequestStatus,
  readonly ServiceRequestStatus[]
> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "CANCELLED"],
  UNDER_REVIEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CAREGIVER_ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  CAREGIVER_ASSIGNED: ["IN_PROGRESS", "CONFIRMED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL_SERVICE_REQUEST_STATUSES: readonly ServiceRequestStatus[] = [
  "COMPLETED",
  "CANCELLED",
];

/**
 * Which roles may perform each transition.
 *
 * FAMILY appears only on edges a family member genuinely owns: submitting
 * their own draft, and cancelling before the service is under way. Everything
 * operational belongs to OPERATIONS_ADMIN. CAREGIVER may only move a request
 * to IN_PROGRESS, and only as a side effect of checking in.
 *
 * Ownership (is this *your* request?) is a separate check performed by the
 * authorization layer; this map answers only "may this role ever do this?".
 */
const TRANSITION_ROLES: Record<string, readonly Role[]> = {
  "DRAFT->SUBMITTED": ["FAMILY", "OPERATIONS_ADMIN"],
  "DRAFT->CANCELLED": ["FAMILY", "OPERATIONS_ADMIN"],
  "SUBMITTED->UNDER_REVIEW": ["OPERATIONS_ADMIN"],
  "SUBMITTED->CANCELLED": ["FAMILY", "OPERATIONS_ADMIN"],
  "UNDER_REVIEW->CONFIRMED": ["OPERATIONS_ADMIN"],
  "UNDER_REVIEW->CANCELLED": ["FAMILY", "OPERATIONS_ADMIN"],
  "CONFIRMED->CAREGIVER_ASSIGNED": ["OPERATIONS_ADMIN"],
  "CONFIRMED->IN_PROGRESS": ["OPERATIONS_ADMIN"],
  "CONFIRMED->CANCELLED": ["FAMILY", "OPERATIONS_ADMIN"],
  "CAREGIVER_ASSIGNED->IN_PROGRESS": ["CAREGIVER", "OPERATIONS_ADMIN"],
  "CAREGIVER_ASSIGNED->CONFIRMED": ["OPERATIONS_ADMIN"],
  "CAREGIVER_ASSIGNED->CANCELLED": ["FAMILY", "OPERATIONS_ADMIN"],
  "IN_PROGRESS->COMPLETED": ["OPERATIONS_ADMIN"],
  "IN_PROGRESS->CANCELLED": ["OPERATIONS_ADMIN"],
};

function edgeKey(from: ServiceRequestStatus, to: ServiceRequestStatus): string {
  return `${from}->${to}`;
}

export function allowedTransitions(from: ServiceRequestStatus): readonly ServiceRequestStatus[] {
  return SERVICE_REQUEST_TRANSITIONS[from];
}

export function isTerminal(status: ServiceRequestStatus): boolean {
  return TERMINAL_SERVICE_REQUEST_STATUSES.includes(status);
}

export function canTransition(from: ServiceRequestStatus, to: ServiceRequestStatus): boolean {
  return SERVICE_REQUEST_TRANSITIONS[from].includes(to);
}

/** Whether `role` is ever permitted to make this transition, ignoring ownership. */
export function canRoleTransition(
  role: Role,
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): boolean {
  if (!canTransition(from, to)) return false;
  return (TRANSITION_ROLES[edgeKey(from, to)] ?? []).includes(role);
}

/** Transitions `role` could make from `from`. Used to build UI action lists. */
export function allowedTransitionsForRole(
  role: Role,
  from: ServiceRequestStatus,
): readonly ServiceRequestStatus[] {
  return allowedTransitions(from).filter((to) => canRoleTransition(role, from, to));
}

/**
 * Throws unless the transition is legal for this role. Mutation paths call
 * this before touching the database.
 */
export function assertTransition(
  role: Role,
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(
      `This request cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`,
      { from, to },
    );
  }
  if (!canRoleTransition(role, from, to)) {
    throw new ConflictError("You do not have permission to make this change.", { from, to, role });
  }
}

export const STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  CONFIRMED: "Confirmed",
  CAREGIVER_ASSIGNED: "Companion assigned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Plain-language explanation shown to families. No medical framing. */
export const STATUS_DESCRIPTIONS: Record<ServiceRequestStatus, string> = {
  DRAFT: "Not submitted yet. You can still make changes.",
  SUBMITTED: "Received. Our coordination team will review it shortly.",
  UNDER_REVIEW: "A coordinator is arranging the details.",
  CONFIRMED: "Arrangements are set for the scheduled date.",
  CAREGIVER_ASSIGNED: "A companion has been assigned to this visit.",
  IN_PROGRESS: "This visit is under way.",
  COMPLETED: "This visit is finished.",
  CANCELLED: "This request was cancelled.",
};
