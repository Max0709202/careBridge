import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";

/**
 * Supabase client bound to the current request's cookies, for use in Server
 * Components, server actions, and route handlers.
 *
 * Auth cookies are marked Secure (outside development) and SameSite=Lax. They
 * are not HttpOnly by design: the browser Supabase client reads the session
 * from them, which is the documented @supabase/ssr cookie flow. XSS is
 * mitigated by React's output escaping, the CSP set in middleware, and the
 * absence of any `dangerouslySetInnerHTML`.
 */
export async function createSupabaseServerClient() {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see docs/DATABASE.md).",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookieOptions: {
      sameSite: "lax",
      secure: serverEnv.APP_ENV !== "development",
      path: "/",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `set` throws when called from a Server Component render. That is
          // expected: middleware refreshes the session cookie on every request,
          // so nothing is lost here.
        }
      },
    },
  });
}
