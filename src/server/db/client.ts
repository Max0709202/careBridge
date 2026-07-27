import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/lib/env/server";

import * as schema from "./schema";

/**
 * The trusted database connection.
 *
 * This connects with a privileged role, so Row Level Security does NOT
 * constrain queries made through it. That is deliberate: it places the burden
 * of authorization on the server `authz` layer, which every mutation and query
 * path must consult first. RLS is defence in depth for the Supabase data API
 * and for RLS-scoped access via `withUserRls` — never a substitute for the
 * application check. See docs/DECISIONS.md #7 and SECURITY.md.
 *
 * The connection is created LAZILY, on first query — importing this module must
 * never open a socket, or a build-time prerender (which has no DATABASE_URL)
 * would fail just by pulling in the import graph. A module-level singleton then
 * avoids exhausting connections across dev HMR and serverless invocations.
 */

type Client = { sql: ReturnType<typeof postgres>; db: ReturnType<typeof drizzle<typeof schema>> };

function createClient(): Client {
  if (!serverEnv.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Start the local stack with `pnpm supabase:start` and copy values into .env.local (see docs/DATABASE.md).",
    );
  }
  const sql = postgres(serverEnv.DATABASE_URL, {
    max: 10,
    prepare: false, // safe with Supabase's transaction pooler
  });
  return { sql, db: drizzle(sql, { schema, casing: "snake_case" }) };
}

const globalForDb = globalThis as unknown as { __carebridgeDb?: Client };

function getClient(): Client {
  const existing = globalForDb.__carebridgeDb;
  if (existing) return existing;
  const created = createClient();
  if (serverEnv.APP_ENV !== "production") globalForDb.__carebridgeDb = created;
  return created;
}

export type Database = Client["db"];

/**
 * Drizzle client. Authorization must already have been checked before use.
 * A lazy proxy so that importing this module does not open a connection;
 * function members are bound to the real client so `this` is correct.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getClient().db as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/** Raw postgres-js handle, for the RLS helper and health checks. */
export function getSqlClient() {
  return getClient().sql;
}

export { schema };
