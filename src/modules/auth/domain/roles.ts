/**
 * Roles.
 *
 * Every user has exactly ONE primary role in the MVP. There is no role
 * hierarchy and no implicit inheritance: an operations admin is not "a family
 * user with extras", they are a different principal with a different data
 * scope. Keeping it flat means every authorization decision is a direct
 * lookup rather than a traversal, which is far easier to audit.
 */

export const ROLES = ["FAMILY", "CAREGIVER", "OPERATIONS_ADMIN"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  FAMILY: "Family",
  CAREGIVER: "Caregiver",
  OPERATIONS_ADMIN: "Operations",
};

/** Landing route for each role after sign-in. */
export const ROLE_HOME: Record<Role, string> = {
  FAMILY: "/family/dashboard",
  CAREGIVER: "/caregiver/dashboard",
  OPERATIONS_ADMIN: "/operations/dashboard",
};
