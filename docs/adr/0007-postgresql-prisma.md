# ADR-0007 · PostgreSQL with Prisma

**Status:** Accepted · **Date:** 2026-07-27

## Context

The data is a densely related transactional graph — user → patient →
appointment → ride → assignment → payment. The invariants are exactly the ones
relational constraints exist to protect: a ride cannot outlive its appointment;
an assignment cannot reference an unapproved driver.

Money and state transitions need real transactions and `SELECT … FOR UPDATE`.
Audit and consent need durable, queryable, append-only history.

## Decision

**PostgreSQL 16** as the source of truth, with **Prisma** as the client and
migration tool.

## Alternatives

**MongoDB or another document store.** The access pattern is joins. Modelling
this graph as documents means either duplicating data across them — and then
owning consistency in application code — or performing joins in the
application, which is the worst of both.

**Raw SQL with a query builder.** More control, no generated types. The
generated client is what makes the DTO mappers type-check end to end, and that
type safety is doing real work in a codebase where a missed null is a 500 on a
family's dashboard.

**TypeORM / Drizzle.** Both viable. Prisma's migration workflow and transaction
ergonomics are better for a small team, and `$transaction(async tx => …)` with
the client threaded through is what makes "the audit row commits with the
change it describes" natural rather than careful.

## Prisma's known weaknesses, and why they are acceptable here

| Weakness | Why it does not bite |
| -------- | -------------------- |
| Limited row-level-security support | Authorisation is enforced in the application layer **by design** — see [ADR-0010](0010-multi-tenancy.md) |
| Weak on complex geospatial and window queries | `$queryRaw` with typed parameters covers the few analytical queries we need; PostGIS is deferred (T5) |
| Generated client is a build step | Already in CI, and its absence is a loud failure rather than a subtle one |

## Consequences

- Partial and composite indexes serve the dispatcher's "unassigned rides in the
  next four hours" query well past pilot scale.
- Migrations are **forward-only**. There is no `migrate down`: a
  down-migration written months earlier and never executed is not a tested
  recovery path. A bad migration is corrected by a new one, and the recovery
  path for a destructive one is a rehearsed restore.
- CI asserts that committed migrations apply to a clean database, and that
  `schema.prisma` has no changes without a migration.
- Money is integer cents everywhere. Never a float.

## Revisit when

- PostGIS becomes necessary — when driver–pickup matching becomes automatic
  (Stage 5D). That is an extension to this decision, not a replacement.
- Read replicas are needed (Stage 5E).
- Analytical queries outgrow `$queryRaw`, at which point the answer is a data
  warehouse rather than a different transactional database.
