# Database & auth (Phase 2)

CareBridge uses **Supabase** (Postgres + GoTrue Auth) run locally in **Docker**,
with **Drizzle** as the single source of truth for the schema and migrations.

## Prerequisites

- Docker (Desktop, or Engine in WSL 2). The Supabase CLI manages the container
  stack for you.

> If Docker cannot run in your environment, the app can't run — but the schema,
> migrations, RLS policies, and authorization are all verified without Docker by
> the `pnpm test:rls` suite (in-process WASM Postgres). See "Testing RLS".

## First-time setup

```bash
pnpm install
cp .env.example .env.local        # or use the committed dev defaults in .env.local
pnpm supabase:start               # boots Postgres + Auth in Docker (first run pulls images)
pnpm db:migrate                   # apply Drizzle migrations (schema + RLS + triggers)
pnpm db:seed                      # load clearly fictional data
pnpm dev                          # http://localhost:3000
```

`pnpm supabase:start` prints the local API URL, anon key, and service-role key.
The committed `.env.local` already contains the CLI's well-known local defaults;
if yours differ, paste them in.

### Seeded accounts (all password `CareBridgeDev!234`)

| Role       | Email                        |
| ---------- | ---------------------------- |
| Operations | `ops@carebridge.test`        |
| Family     | `rivera.family@example.test` |
| Caregiver  | `sam.companion@example.test` |

## Commands

| Command                    | What it does                                                     |
| -------------------------- | --------------------------------------------------------------- |
| `pnpm supabase:start`      | Start the local Supabase Docker stack                            |
| `pnpm supabase:stop`       | Stop it                                                          |
| `pnpm db:generate`         | Generate a migration from the Drizzle schema                     |
| `pnpm db:generate:custom`  | Create an empty migration for hand-written SQL (RLS, functions)  |
| `pnpm db:migrate`          | Apply pending migrations to `DATABASE_URL`                       |
| `pnpm db:seed`             | Load fictional development data                                  |
| `pnpm db:reset`            | Drop, re-migrate, and re-seed the local database                 |
| `pnpm db:studio`           | Open Drizzle Studio                                              |
| `pnpm test:rls`            | Run RLS ownership tests (no Docker required)                     |

## Why Drizzle owns migrations

The stack lists both Drizzle and Supabase, which each have a migration system.
Running two is a recipe for drift, so:

- **Drizzle is authoritative.** `supabase/config.toml` sets
  `[db.migrations] enabled = false` and `[db.seed] enabled = false`. The CLI only
  runs the container stack.
- Table DDL is generated from `src/server/db/schema/*` into `drizzle/*.sql`.
- Roles, grants, RLS policies, the `updated_at` trigger, and the signup trigger
  are hand-authored SQL in `drizzle/0001_functions_rls_policies.sql`.

## The `auth.users` reference

`public.users` has a foreign key to Supabase's `auth.users`. Drizzle's
`schemaFilter` is set to `["public"]` so it never manages the `auth` schema. The
first migration creates `auth.users` only with `IF NOT EXISTS`, so it is a no-op
on real Supabase (where GoTrue owns it) and a usable stub on a bare Postgres or
the test harness.

## Authorization: two layers

1. **Server `authz` (primary).** Every server action and query path resolves an
   `AuthContext` (`src/server/authz`) and checks role + ownership before
   touching data. The app's Drizzle connection is privileged and bypasses RLS,
   so this check is what actually protects data on the app's own query path.
2. **Row Level Security (defence in depth).** Every table has RLS enabled with
   policies scoped to `authenticated` (see the authorization matrix). This
   protects any access through the Supabase data API and RLS-scoped access via
   `withUserRls`, and is what the RLS test suite exercises.

See [../SECURITY.md](../SECURITY.md) and [DECISIONS.md](DECISIONS.md) #7.

## The signup trigger and roles

`handle_new_user` (on `auth.users` insert) creates the `public.users` row and,
for a family user, a `family_account` + `OWNER` membership; for a caregiver, a
`caregiver_profile`.

**Role is read only from `app_metadata`** (set by the service role / admin API),
never from `user_metadata` (which the client controls at signup). Self-service
signup therefore always yields a `FAMILY` account; caregivers and operations
staff are provisioned separately with a role in `app_metadata`. A test asserts a
role smuggled into `user_metadata` is ignored.

## Testing RLS without Docker

`pnpm test:rls` runs the policies against in-process WASM Postgres (pglite). The
harness (`tests/integration/harness.ts`) creates the `anon` / `authenticated`
roles, an `auth.users` stub, and `auth.uid()`, applies the real Drizzle
migrations, then runs queries as each role with `request.jwt.claims` set — the
same path a Supabase data-API request takes. This is how ownership boundaries
are verified in CI and in environments where Docker is unavailable.
