import { NextResponse, type NextRequest } from "next/server";

import { ROLE_HOME } from "@/modules/auth/domain/roles";
import { getAuthContext } from "@/server/authz";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * OAuth / email-confirmation callback. Exchanges the auth code for a session,
 * then routes the user to their role's home. Used when email confirmation is
 * enabled; harmless when it is not.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  const ctx = await getAuthContext();
  const destination = ctx ? ROLE_HOME[ctx.role] : "/sign-in";
  return NextResponse.redirect(new URL(destination, origin));
}
