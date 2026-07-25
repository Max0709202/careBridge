import { describe, expect, it } from "vitest";

import { ConflictError } from "@/lib/errors";
import { ROLES, type Role } from "@/modules/auth/domain/roles";
import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TRANSITIONS,
  allowedTransitionsForRole,
  assertTransition,
  canRoleTransition,
  canTransition,
  isServiceRequestStatus,
  isTerminal,
  type ServiceRequestStatus,
} from "@/modules/service-requests/domain/status";

/**
 * The state machine is the safety rail for the whole request lifecycle, so it
 * is tested exhaustively rather than by example: every (from, to) pair and
 * every (role, from, to) triple is asserted against the declared maps.
 */

const ALL_PAIRS: Array<[ServiceRequestStatus, ServiceRequestStatus]> =
  SERVICE_REQUEST_STATUSES.flatMap((from) =>
    SERVICE_REQUEST_STATUSES.map(
      (to) => [from, to] as [ServiceRequestStatus, ServiceRequestStatus],
    ),
  );

describe("service request status guards", () => {
  it("recognises only declared statuses", () => {
    expect(isServiceRequestStatus("SUBMITTED")).toBe(true);
    expect(isServiceRequestStatus("submitted")).toBe(false);
    expect(isServiceRequestStatus("ARCHIVED")).toBe(false);
    expect(isServiceRequestStatus(undefined)).toBe(false);
  });

  it("treats COMPLETED and CANCELLED as terminal with no outgoing edges", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(SERVICE_REQUEST_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(SERVICE_REQUEST_TRANSITIONS.CANCELLED).toHaveLength(0);
  });

  it("never allows a status to transition to itself", () => {
    for (const status of SERVICE_REQUEST_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("allows exactly the declared transitions and nothing else", () => {
    for (const [from, to] of ALL_PAIRS) {
      expect(canTransition(from, to)).toBe(SERVICE_REQUEST_TRANSITIONS[from].includes(to));
    }
  });

  it("allows every non-terminal status to be cancelled", () => {
    for (const status of SERVICE_REQUEST_STATUSES) {
      if (isTerminal(status)) continue;
      expect(canTransition(status, "CANCELLED")).toBe(true);
    }
  });
});

describe("service request transitions by role", () => {
  it("never grants a role a transition the machine itself forbids", () => {
    for (const role of ROLES) {
      for (const [from, to] of ALL_PAIRS) {
        if (canRoleTransition(role, from, to)) {
          expect(canTransition(from, to)).toBe(true);
        }
      }
    }
  });

  it("lets a family user submit and cancel, but not review or confirm", () => {
    expect(canRoleTransition("FAMILY", "DRAFT", "SUBMITTED")).toBe(true);
    expect(canRoleTransition("FAMILY", "SUBMITTED", "CANCELLED")).toBe(true);
    expect(canRoleTransition("FAMILY", "SUBMITTED", "UNDER_REVIEW")).toBe(false);
    expect(canRoleTransition("FAMILY", "UNDER_REVIEW", "CONFIRMED")).toBe(false);
  });

  it("does not let a family user cancel a visit that is already under way", () => {
    expect(canRoleTransition("FAMILY", "IN_PROGRESS", "CANCELLED")).toBe(false);
    expect(canRoleTransition("OPERATIONS_ADMIN", "IN_PROGRESS", "CANCELLED")).toBe(true);
  });

  it("reserves caregiver assignment for operations", () => {
    for (const role of ROLES) {
      const permitted = canRoleTransition(role, "CONFIRMED", "CAREGIVER_ASSIGNED");
      expect(permitted).toBe(role === "OPERATIONS_ADMIN");
    }
  });

  it("lets a caregiver only start a visit they were assigned to", () => {
    expect(canRoleTransition("CAREGIVER", "CAREGIVER_ASSIGNED", "IN_PROGRESS")).toBe(true);

    // Everything else in the lifecycle is closed to caregivers.
    const caregiverEdges = ALL_PAIRS.filter(([from, to]) =>
      canRoleTransition("CAREGIVER", from, to),
    );
    expect(caregiverEdges).toEqual([["CAREGIVER_ASSIGNED", "IN_PROGRESS"]]);
  });

  it("reserves completion for operations", () => {
    for (const role of ROLES) {
      expect(canRoleTransition(role, "IN_PROGRESS", "COMPLETED")).toBe(role === "OPERATIONS_ADMIN");
    }
  });

  it("lists only the transitions a role can actually make", () => {
    expect(allowedTransitionsForRole("FAMILY", "DRAFT")).toEqual(["SUBMITTED", "CANCELLED"]);
    expect(allowedTransitionsForRole("CAREGIVER", "DRAFT")).toEqual([]);
    expect(allowedTransitionsForRole("OPERATIONS_ADMIN", "CONFIRMED")).toEqual([
      "CAREGIVER_ASSIGNED",
      "IN_PROGRESS",
      "CANCELLED",
    ]);
  });
});

describe("assertTransition", () => {
  it("passes for a legal transition", () => {
    expect(() => assertTransition("OPERATIONS_ADMIN", "SUBMITTED", "UNDER_REVIEW")).not.toThrow();
  });

  it("rejects a structurally impossible transition", () => {
    expect(() => assertTransition("OPERATIONS_ADMIN", "COMPLETED", "IN_PROGRESS")).toThrow(
      ConflictError,
    );
  });

  it("rejects a legal transition attempted by the wrong role", () => {
    expect(() => assertTransition("FAMILY", "UNDER_REVIEW", "CONFIRMED")).toThrow(ConflictError);
  });

  it("does not leak internal detail in the user-facing message", () => {
    try {
      assertTransition("CAREGIVER", "CONFIRMED", "CAREGIVER_ASSIGNED");
      expect.unreachable("expected a ConflictError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).userMessage).toBe(
        "You do not have permission to make this change.",
      );
    }
  });

  it("covers every role without special-casing", () => {
    const roles: readonly Role[] = ROLES;
    expect(roles).toHaveLength(3);
  });
});
