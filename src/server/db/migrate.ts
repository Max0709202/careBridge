/**
 * Applies pending Drizzle migrations to DATABASE_URL.
 *
 * Run with `pnpm db:migrate` after `pnpm supabase:start`. This is a standalone
 * script (not part of the app runtime), so it reads env via dotenv and does not
 * import the `server-only` client.
 */
import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to run migrations. See docs/DATABASE.md.");
  }

  // A dedicated single connection for the migration run; closed at the end.
  const sql = postgres(url, { max: 1 });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
