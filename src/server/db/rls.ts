import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { db, schema } from "./client";

/**
 * Run a block of queries with Row Level Security enforced as a specific user.
 *
 * Even over a privileged connection, `SET LOCAL ROLE authenticated` plus a
 * `request.jwt.claims` payload makes RLS apply for the duration of the
 * transaction — exactly as it would for a request arriving through the Supabase
 * data API. Use this for read/write paths where you want the database to
 * independently re-check ownership, on top of the server `authz` layer.
 *
 * The role is reset automatically when the transaction ends (`SET LOCAL`).
 */
export async function withUserRls<T>(
  userId: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'authenticated', true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: userId,
        role: "authenticated",
      })}, true)`,
    );
    return fn(tx as unknown as PostgresJsDatabase<typeof schema>);
  });
}

/**
 * Run a block with RLS enforced as an anonymous (signed-out) caller. Mainly
 * useful in tests to prove that unauthenticated access sees nothing.
 */
export async function withAnonRls<T>(
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'anon', true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({ role: "anon" })}, true)`,
    );
    return fn(tx as unknown as PostgresJsDatabase<typeof schema>);
  });
}
