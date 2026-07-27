import "server-only";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";

import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { ROLE_HOME, isRole, type Role } from "@/modules/auth/domain/roles";
import { db } from "@/server/db/client";
import { caregiverProfiles, familyMembers, users } from "@/server/db/schema";
import { createSupabaseServerClient } from "@/server/supabase/server";

import type { AuthContext } from "./types";

/**
 * Resolves the current caller into an {@link AuthContext}, or null when signed
 * out. Wrapped in React `cache` so multiple guards in one request share a
 * single database round-trip.
 *
 * The auth identity comes from Supabase (a verified JWT via `getUser`); the
 * role and memberships come from our own tables over the trusted connection.
 * Role is therefore always server-derived, never taken from the client.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!profile) return null;

  if (!isRole(profile.role)) {
    // The database enum and the domain union have drifted — refuse rather than
    // guess at a role.
    throw new AuthorizationError("Unrecognized role on user record", { actorId: profile.id });
  }

  const memberships = await db
    .select({ familyAccountId: familyMembers.familyAccountId })
    .from(familyMembers)
    .where(eq(familyMembers.userId, user.id));

  const caregiver =
    profile.role === "CAREGIVER"
      ? await db.query.caregiverProfiles.findFirst({
          where: eq(caregiverProfiles.userId, user.id),
        })
      : null;

  return {
    userId: profile.id,
    email: profile.email,
    role: profile.role,
    displayName: profile.displayName,
    familyAccountIds: memberships.map((m) => m.familyAccountId),
    caregiverProfileId: caregiver?.id ?? null,
  };
});

/** Throws {@link AuthenticationError} when there is no signed-in user. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthenticationError("Authentication required");
  return ctx;
}

/** Requires a specific role. Throws when signed out or the role differs. */
export async function requireRole(role: Role): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (ctx.role !== role) {
    throw new AuthorizationError("Role required", { required: role, actual: ctx.role });
  }
  return ctx;
}

/**
 * Page/layout guard: sends signed-out users to sign-in and users of the wrong
 * role to their own home, rather than throwing. Use this in route-group
 * layouts. `redirect()` returns `never`, so the returned context is non-null.
 */
export async function requirePageRole(role: Role): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/sign-in");
  if (ctx.role !== role) redirect(ROLE_HOME[ctx.role]);
  return ctx;
}
