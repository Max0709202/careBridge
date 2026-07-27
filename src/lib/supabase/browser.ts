"use client";

import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env/client";

/**
 * Supabase client for Client Components. Uses only public configuration — the
 * anon key and project URL, which are safe in the browser because Row Level
 * Security, not their secrecy, protects the data.
 */
export function createSupabaseBrowserClient() {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured for the browser client.");
  }
  return createBrowserClient(url, anonKey);
}
