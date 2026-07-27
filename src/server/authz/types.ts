import type { Role } from "@/modules/auth/domain/roles";

/**
 * The authenticated caller, resolved once per request. Everything an
 * authorization decision needs is here, so policy functions can stay pure and
 * synchronous.
 */
export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  displayName: string | null;
  /** Family accounts this user belongs to (usually one). Empty for non-family. */
  familyAccountIds: readonly string[];
  /** The user's caregiver profile id, if they are a caregiver. */
  caregiverProfileId: string | null;
}
