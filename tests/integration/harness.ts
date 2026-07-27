import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * In-process Postgres (WASM) test harness for Row Level Security.
 *
 * Docker cannot run in every environment (CI, this sandbox), so RLS is verified
 * against pglite — real Postgres, no daemon. The harness recreates the small
 * slice of Supabase that our migrations depend on:
 *
 *   - the `anon` / `authenticated` / `service_role` roles,
 *   - the `auth` schema, an `auth.users` table shaped like GoTrue's (enough
 *     columns for the signup trigger), and `auth.uid()`.
 *
 * Our Drizzle migrations then run unchanged. Because the migrations create the
 * auth bits with IF NOT EXISTS, they are no-ops here and untouched on real
 * Supabase.
 *
 * Queries run through `asUser` / `asAnon` execute inside a transaction with
 * `role` and `request.jwt.claims` set, so RLS applies exactly as it would to a
 * request arriving through the Supabase data API. Superuser bypasses RLS, which
 * is why seeding uses `asSuper`.
 */

const MIGRATIONS = ["0000_core_schema.sql", "0001_functions_rls_policies.sql"];

const SUPABASE_COMPAT_SQL = `
  -- Roles that our grants and policies reference.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  end $$;

  create schema if not exists auth;

  -- Minimal GoTrue-shaped users table: enough for the signup trigger.
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
`;

export interface TestDb {
  pg: PGlite;
  /** Run as the privileged owner (bypasses RLS). Used for seeding. */
  asSuper: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
  /** Run as an authenticated user with the given id, subject to RLS. */
  asUser: <T = Record<string, unknown>>(
    userId: string,
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
  /** Run as an anonymous (signed-out) caller, subject to RLS. */
  asAnon: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
  /** Seed an auth user (fires the signup trigger). Returns the new id. */
  seedAuthUser: (input: {
    id?: string;
    email: string;
    role?: "FAMILY" | "CAREGIVER" | "OPERATIONS_ADMIN";
    displayName?: string;
    accountName?: string;
  }) => Promise<string>;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = await PGlite.create();

  await pg.exec(SUPABASE_COMPAT_SQL);
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf8");
    await pg.exec(sql);
  }

  async function asSuper<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await pg.query<T>(text, params);
    return res.rows;
  }

  async function runScoped<T>(
    claims: Record<string, unknown>,
    role: string,
    text: string,
    params: unknown[],
  ): Promise<T[]> {
    await pg.exec("begin");
    try {
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await pg.query("select set_config('role', $1, true)", [role]);
      const res = await pg.query<T>(text, params);
      await pg.exec("rollback");
      return res.rows;
    } catch (error) {
      await pg.exec("rollback");
      throw error;
    }
  }

  return {
    pg,
    asSuper,
    asUser: (userId, text, params = []) =>
      runScoped({ sub: userId, role: "authenticated" }, "authenticated", text, params),
    asAnon: (text, params = []) => runScoped({ role: "anon" }, "anon", text, params),
    async seedAuthUser({ id, email, role = "FAMILY", displayName, accountName }) {
      const rows = await asSuper<{ id: string }>(
        `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3::jsonb, $4::jsonb)
         returning id`,
        [
          id ?? null,
          email,
          JSON.stringify({ role }),
          JSON.stringify({
            ...(displayName ? { display_name: displayName } : {}),
            ...(accountName ? { account_name: accountName } : {}),
          }),
        ],
      );
      return rows[0]!.id;
    },
    close: () => pg.close(),
  };
}
