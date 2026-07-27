import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { buildCsp } from "@/server/security/csp";

/**
 * Runs on every non-asset request (Next 16 "proxy" convention, formerly
 * "middleware"). Two request-scoped jobs:
 *
 *   1. Refresh the Supabase auth session so Server Components always see a
 *      current user (the documented @supabase/ssr flow).
 *   2. Attach the Content-Security-Policy header.
 *
 * When Supabase is not configured, the session refresh is skipped but the
 * security header is still applied.
 */
export default async function proxy(request: NextRequest) {
  const csp = buildCsp({
    appEnv: serverEnv.APP_ENV,
    supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
  });

  let response = NextResponse.next({ request });

  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // Do not insert code between client creation and this call: it refreshes
    // the session cookie. A transient auth-server failure must not take down
    // page delivery.
    try {
      await supabase.auth.getUser();
    } catch {
      // Session stays as-is for this request.
    }
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Skip Next internals and static assets; everything else gets a session
  // refresh and the CSP header.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
