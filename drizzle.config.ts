import "dotenv/config";

import { defineConfig } from "drizzle-kit";

/**
 * Drizzle is the single source of truth for the database schema and for
 * migrations (tables, roles, grants, RLS policies, and the auth trigger). The
 * Supabase CLI only runs the local Postgres + Auth Docker stack; it does not
 * manage migrations. See docs/DATABASE.md.
 *
 * `pnpm db:generate` diffs the schema below into a new SQL migration under
 * ./drizzle. Hand-authored SQL (RLS etc.) is added with `db:generate:custom`.
 * `pnpm db:migrate` applies pending migrations to DATABASE_URL.
 */
export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Columns are written camelCase in TypeScript and mapped to snake_case in
  // Postgres, so both sides read idiomatically.
  casing: "snake_case",
  // Only manage the `public` schema. Supabase owns `auth` (GoTrue); we
  // reference auth.users for a foreign key but must never try to create or
  // drop it.
  schemaFilter: ["public"],
  dbCredentials: {
    // Only used by commands that touch a live database (migrate/push/studio).
    // `generate` works purely from the schema and needs no connection.
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  verbose: true,
  strict: true,
});
