import { describe, expect, it } from "vitest";

import { ConflictError } from "@/lib/errors";
import { ROLES } from "@/modules/auth/domain/roles";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  assertAssignmentTransition,
  canAssignmentTransition,
  canRoleAssignmentTransition,
  isAssignmentStatus,
  isAssignmentTerminal,
  type AssignmentStatus,
} from "@/modules/assignments/domain/status";

const ALL_PAIRS: Array<[AssignmentStatus, AssignmentStatus]> = ASSIGNMENT_STATUSES.flatMap((from) =>
  ASSIGNMENT_STATUSES.map((to) => [from, to] as [AssignmentStatus, AssignmentStatus]),
);

describe("assignment status guards", () => {
  it("recognises only declared statuses", () => {
    expect(isAssignmentStatus("OFFERED")).toBe(true);
    expect(isAssignmentStatus("PENDING")).toBe(false);
  });

  it("allows exactly the declared transitions", () => {
    for (const [from, to] of ALL_PAIRS) {
      expect(canAssignmentTransition(from, to)).toBe(ASSIGNMENT_TRANSITIONS[from].includes(to));
    }
  });

  it("treats REJECTED, COMPLETED and CANCELLED as terminal", () => {
    for (const status of ["REJECTED", "COMPLETED", "CANCELLED"] as const) {
      expect(isAssignmentTerminal(status)).toBe(true);
      expect(ASSIGNMENT_TRANSITIONS[status]).toHaveLength(0);
    }
  });

  it("does not allow an offer to jump straight to in-progress", () => {
    // A caregiver must accept before they can check in.
    expect(canAssignmentTransition("OFFERED", "IN_PROGRESS")).toBe(false);
  });

  it("does not allow a declined offer to be revived", () => {
    for (const to of ASSIGNMENT_STATUSES) {
      expect(canAssignmentTransition("REJECTED", to)).toBe(false);
    }
  });
});

describe("assignment transitions by role", () => {
  it("gives the caregiver accept, decline, check-in and check-out", () => {
    const caregiverEdges = ALL_PAIRS.filter(([from, to]) =>
      canRoleAssignmentTransition("CAREGIVER", from, to),
    );
    expect(caregiverEdges).toEqual([
      ["OFFERED", "ACCEPTED"],
      ["OFFERED", "REJECTED"],
      ["ACCEPTED", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ]);
  });

  it("reserves cancellation for operations", () => {
    for (const role of ROLES) {
      expect(canRoleAssignmentTransition(role, "ACCEPTED", "CANCELLED")).toBe(
        role === "OPERATIONS_ADMIN",
      );
    }
  });

  it("gives family users no control over assignments at all", () => {
    const familyEdges = ALL_PAIRS.filter(([from, to]) =>
      canRoleAssignmentTransition("FAMILY", from, to),
    );
    expect(familyEdges).toEqual([]);
  });

  it("does not let operations accept an offer on a caregiver's behalf", () => {
    expect(canRoleAssignmentTransition("OPERATIONS_ADMIN", "OFFERED", "ACCEPTED")).toBe(false);
  });
});

describe("assertAssignmentTransition", () => {
  it("passes for a caregiver checking in on an accepted assignment", () => {
    expect(() => assertAssignmentTransition("CAREGIVER", "ACCEPTED", "IN_PROGRESS")).not.toThrow();
  });

  it("rejects an impossible transition", () => {
    expect(() => assertAssignmentTransition("CAREGIVER", "COMPLETED", "IN_PROGRESS")).toThrow(
      ConflictError,
    );
  });

  it("rejects the right transition by the wrong role", () => {
    expect(() => assertAssignmentTransition("FAMILY", "OFFERED", "ACCEPTED")).toThrow(
      ConflictError,
    );
  });
});
