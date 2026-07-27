import "server-only";

import { createClient } from "@supabase/supabase-js";

import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely, so it is
 * used ONLY for privileged operations that have already been authorized by the
 * server `authz` layer — for example, an operations admin provisioning a
 * caregiver account with a role in app_metadata.
 *
 * Never import this into a Client Component (the `server-only` guard enforces
 * that) and never derive it from user-supplied input without an authz check.
 */
export function createSupabaseAdminClient() {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
