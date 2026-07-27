import { sql } from "drizzle-orm";
import { pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Shared schema building blocks.
 *
 * Conventions for every table in this project:
 *  - UUID primary keys, random by default (never sequential integers, which
 *    leak record counts and invite enumeration).
 *  - `created_at` / `updated_at` as `timestamptz`. `updated_at` is kept current
 *    by a database trigger (see the RLS/functions migration), so application
 *    code cannot forget to bump it.
 *  - All timestamps stored in UTC.
 */

/** Supabase's GoTrue users table. Referenced for foreign keys only — never
 *  created, altered, or dropped by our migrations (see `schemaFilter` in
 *  drizzle.config.ts). */
export const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const primaryId = () => uuid("id").primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * pgEnum wants a mutable `[string, ...string[]]`, but our canonical status
 * lists live in the domain layer as `readonly` tuples. This casts without
 * copying, so the database enum and the domain union cannot drift. A unit test
 * (`tests/unit/schema-enum-parity.test.ts`) asserts they stay identical.
 */
export const enumValues = <T extends readonly string[]>(values: T): [string, ...string[]] =>
  values as unknown as [string, ...string[]];

/** Marker for a US 2-letter state code column constraint. */
export const usStateCheck = (columnSql: string) => sql.raw(`${columnSql} ~ '^[A-Z]{2}$'`);
