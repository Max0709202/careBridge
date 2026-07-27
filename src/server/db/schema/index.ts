/**
 * The database schema, in dependency order.
 *
 * This module is the entry point drizzle-kit reads to generate migrations, and
 * the barrel the data layer imports tables from. Keep it export-only.
 */
export * from "./enums";
export * from "./identity";
export * from "./care";
export * from "./operations";
export * from "./system";

// `authUsers` is exported for the seed/migrate scripts and RLS test harness,
// but it is NOT managed by our migrations (see drizzle.config.ts schemaFilter).
export { authUsers } from "./_shared";
