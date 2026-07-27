import { AuthorizationError } from "@/lib/errors";
import type { Role } from "@/modules/auth/domain/roles";

import type { AuthContext } from "./types";

/**
 * Pure authorization predicates and assertions.
 *
 * This is the server-side authorization the app relies on as its PRIMARY
 * control (RLS is defence in depth). Keeping it free of I/O means every rule is
 * unit tested directly (tests/unit/authz-policy.test.ts), including the
 * negative cases that matter most: the wrong family, the wrong caregiver, the
 * non-admin.
 *
 * Assertions throw `AuthorizationError`, whose user-facing message is identical
 * to `NotFoundError` so callers cannot probe for the existence of a record.
 */

export function isOps(ctx: AuthContext): boolean {
  return ctx.role === "OPERATIONS_ADMIN";
}

export function isFamily(ctx: AuthContext): boolean {
  return ctx.role === "FAMILY";
}

export function isCaregiver(ctx: AuthContext): boolean {
  return ctx.role === "CAREGIVER";
}

/** A family user may reach only their own account(s); ops may reach any. */
export function canAccessFamilyAccount(ctx: AuthContext, familyAccountId: string): boolean {
  return isOps(ctx) || ctx.familyAccountIds.includes(familyAccountId);
}

/** A caregiver may reach only their own assignments; ops may reach any. */
export function canAccessAssignmentAsCaregiver(
  ctx: AuthContext,
  assignmentCaregiverProfileId: string,
): boolean {
  return isOps(ctx) || ctx.caregiverProfileId === assignmentCaregiverProfileId;
}

/** Only operations may assign caregivers to requests. */
export function canAssignCaregivers(ctx: AuthContext): boolean {
  return isOps(ctx);
}

/** Internal operations notes are never visible outside operations. */
export function canReadInternalNotes(ctx: AuthContext): boolean {
  return isOps(ctx);
}

// --- assertions ---------------------------------------------------------------

export function assertRole(ctx: AuthContext, role: Role): void {
  if (ctx.role !== role) {
    throw new AuthorizationError("Role required", {
      actorId: ctx.userId,
      required: role,
      actual: ctx.role,
    });
  }
}

export function assertOps(ctx: AuthContext): void {
  if (!isOps(ctx)) {
    throw new AuthorizationError("Operations role required", {
      actorId: ctx.userId,
      actual: ctx.role,
    });
  }
}

export function assertFamilyAccountAccess(ctx: AuthContext, familyAccountId: string): void {
  if (!canAccessFamilyAccount(ctx, familyAccountId)) {
    throw new AuthorizationError("Family account access denied", {
      actorId: ctx.userId,
      familyAccountId,
    });
  }
}

export function assertCanAssignCaregivers(ctx: AuthContext): void {
  if (!canAssignCaregivers(ctx)) {
    throw new AuthorizationError("Only operations may assign caregivers", {
      actorId: ctx.userId,
      actual: ctx.role,
    });
  }
}

export function assertAssignmentAccessAsCaregiver(
  ctx: AuthContext,
  assignmentCaregiverProfileId: string,
): void {
  if (!canAccessAssignmentAsCaregiver(ctx, assignmentCaregiverProfileId)) {
    throw new AuthorizationError("Assignment access denied", {
      actorId: ctx.userId,
      assignmentCaregiverProfileId,
    });
  }
}
