# ADR-0010 · Application-layer tenancy, not row-level security

**Status:** Accepted · **Date:** 2026-07-27

## Context

CareBridge has an unusual shape: **the thing most queries are scoped by is not
the tenant.**

- A family member has no organisation. Their access is a `PatientAccess` row —
  a *relationship*, with a permission array and a `revokedAt`.
- A dispatcher has no patient grants. Their access is an
  `OrganizationMembership`.
- Both must be answered by the same authorisation service.

There is no single tenant column to filter on.

## Decision

**One policy service in the application layer.** Every protected operation
calls it explicitly. Postgres row-level security is not used.

One thing *is* built now for the future: **`OrganizationMembership` is
many-to-many.** A user may belong to several organisations. That single
decision is what keeps a later multi-tenant model from being a rewrite, and it
costs almost nothing today.

## Alternatives

**Postgres RLS.** Genuinely good when tenancy is one column. Here the dominant
check is a graph traversal — ride → patient → grant — with a permission array
and a revocation timestamp. Expressing that in policy SQL is possible and
unpleasant, Prisma's support for it is limited, and the workarounds put raw SQL
at exactly the boundaries we most want type checking.

Worse: the policy would then exist in **two** places, SQL and the service
layer. Two implementations of an authorisation rule eventually disagree, and
the disagreement is a data leak.

**Schema- or database-per-tenant.** Operational cost with no benefit at pilot
scale, and it forecloses the cross-organisation referral case that Stage 5
needs.

**A tenant id on every table.** Would work for the organisation axis and does
nothing for the patient-relationship axis, which is the one that matters most.

## Consequences

- **We own the discipline.** The mitigation is not a promise: the
  negative-path helper set is a merge requirement, and it covers each specific
  way the check can be wrong — missing entirely, leaking existence through the
  error message, ignoring `revokedAt`, or confirming *a* grant rather than the
  specific permission.
- Isolation is enforced at the point of **reading**. Every patient-scoped query
  carries `where: { patientId: { in: grantedIds } }`, so data the caller has no
  grant for never enters the result set and cannot be leaked by a mapper that
  forgets to check.
- A revoked grant closes every surface at once, on the next request.

## Revisit when

- The negative-path suite starts finding real regressions regularly, which
  would be evidence the discipline is failing rather than holding.
- An enterprise customer contractually requires database-level isolation.
- Cross-organisation referrals (Stage 5B) turn out not to fit the model — that
  is the first case where one patient is legitimately visible to two
  organisations at once, and it is the real test of this decision.
