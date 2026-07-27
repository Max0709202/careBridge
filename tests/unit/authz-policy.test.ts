import { describe, expect, it } from "vitest";

import { AuthorizationError } from "@/lib/errors";
import type { AuthContext } from "@/server/authz/types";
import {
  assertCanAssignCaregivers,
  assertFamilyAccountAccess,
  assertOps,
  canAccessAssignmentAsCaregiver,
  canAccessFamilyAccount,
  canAssignCaregivers,
  canReadInternalNotes,
  isCaregiver,
  isFamily,
  isOps,
} from "@/server/authz/policy";

/**
 * The pure authorization rules — the server-side primary control. Negative
 * cases (wrong family, wrong caregiver, non-admin) are asserted explicitly.
 */

const family = (accountIds: string[]): AuthContext => ({
  userId: "u-family",
  email: "f@example.test",
  role: "FAMILY",
  displayName: null,
  familyAccountIds: accountIds,
  caregiverProfileId: null,
});

const caregiver = (profileId: string): AuthContext => ({
  userId: "u-caregiver",
  email: "c@example.test",
  role: "CAREGIVER",
  displayName: null,
  familyAccountIds: [],
  caregiverProfileId: profileId,
});

const ops: AuthContext = {
  userId: "u-ops",
  email: "o@example.test",
  role: "OPERATIONS_ADMIN",
  displayName: null,
  familyAccountIds: [],
  caregiverProfileId: null,
};

describe("role predicates", () => {
  it("classifies each role", () => {
    expect(isFamily(family(["a"]))).toBe(true);
    expect(isCaregiver(caregiver("p"))).toBe(true);
    expect(isOps(ops)).toBe(true);
    expect(isOps(family(["a"]))).toBe(false);
  });
});

describe("family account access", () => {
  it("allows a family user to reach only their own account", () => {
    const ctx = family(["acct-1"]);
    expect(canAccessFamilyAccount(ctx, "acct-1")).toBe(true);
    expect(canAccessFamilyAccount(ctx, "acct-2")).toBe(false);
  });

  it("lets operations reach any account", () => {
    expect(canAccessFamilyAccount(ops, "acct-anything")).toBe(true);
  });

  it("denies a caregiver family-account access", () => {
    expect(canAccessFamilyAccount(caregiver("p"), "acct-1")).toBe(false);
  });

  it("throws for the wrong family, with a non-leaking message", () => {
    try {
      assertFamilyAccountAccess(family(["acct-1"]), "acct-2");
      expect.unreachable("expected AuthorizationError");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).userMessage).toBe(
        "You do not have access to this item.",
      );
    }
  });
});

describe("caregiver assignment access", () => {
  it("allows a caregiver to reach only their own assignment", () => {
    const ctx = caregiver("prof-1");
    expect(canAccessAssignmentAsCaregiver(ctx, "prof-1")).toBe(true);
    expect(canAccessAssignmentAsCaregiver(ctx, "prof-2")).toBe(false);
  });

  it("lets operations reach any assignment", () => {
    expect(canAccessAssignmentAsCaregiver(ops, "prof-x")).toBe(true);
  });
});

describe("assignment authority (admin-only)", () => {
  it("permits only operations to assign caregivers", () => {
    expect(canAssignCaregivers(ops)).toBe(true);
    expect(canAssignCaregivers(family(["a"]))).toBe(false);
    expect(canAssignCaregivers(caregiver("p"))).toBe(false);
  });

  it("assertCanAssignCaregivers throws for non-ops", () => {
    expect(() => assertCanAssignCaregivers(family(["a"]))).toThrow(AuthorizationError);
    expect(() => assertCanAssignCaregivers(caregiver("p"))).toThrow(AuthorizationError);
    expect(() => assertCanAssignCaregivers(ops)).not.toThrow();
  });
});

describe("internal notes visibility", () => {
  it("is operations-only", () => {
    expect(canReadInternalNotes(ops)).toBe(true);
    expect(canReadInternalNotes(family(["a"]))).toBe(false);
    expect(canReadInternalNotes(caregiver("p"))).toBe(false);
  });
});

describe("assertOps", () => {
  it("passes for ops and throws for everyone else", () => {
    expect(() => assertOps(ops)).not.toThrow();
    expect(() => assertOps(family(["a"]))).toThrow(AuthorizationError);
    expect(() => assertOps(caregiver("p"))).toThrow(AuthorizationError);
  });
});
