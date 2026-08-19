# Multi-tenancy

## What exists now

The MVP runs a single pilot operator in a single metro area (O1). It would
therefore be entirely possible to build with no tenancy model at all, and
retrofitting one later would be a rewrite of every query in the system.

So one thing was to be built now and everything else deferred:

**`OrganizationMembership` is many-to-many.** A user may belong to several
organisations. That single decision is what keeps a later multi-tenant model
from being a rewrite, and it costs almost nothing today.

For most of Stage 2 that paragraph described an intention rather than a table —
this document claimed a model the schema did not have. It is real now, and what
made it real was a *commercial* requirement rather than a tenancy one: once a
dispatch operator pays for seats
([ADR-0011](../adr/0011-two-sided-subscription-billing.md)), it must be a row
somebody can be billed as and sign in to. `Organization`,
`OrganizationMembership` with an `OrgRole`, and a `BillingAccount` keyed to
either a user or an organisation all exist as of that change.

## The three tenancy axes

CareBridge has an unusual shape: the thing most queries are scoped by is **not**
the tenant.

| Axis | Carried by | Used for |
| ---- | ---------- | -------- |
| **Patient relationship** | `PatientAccess` | Almost every family-facing query |
| **Organisation membership** | `OrganizationMembership` | Dispatcher and admin queries, and everything about an operator's bill |
| **Resource ownership** | The row itself | "Is this your session, your device, your notification" |

A family member has no organisation. A dispatcher has no patient grants. The
authorisation service answers both, and the important consequence is that
**there is no single tenant column to filter on** — which is precisely why a
row-level-security approach was not chosen.

## Why authorisation is in the application, not in the database

Postgres RLS is a genuinely good mechanism when tenancy is one column. Here it
is not:

- The dominant check is a *relationship* — a row in `PatientAccess` with a
  permission array and a `revokedAt` — resolved by traversing up a graph from
  a ride or an appointment.
- Prisma's RLS support is limited, and the workarounds involve raw SQL at
  exactly the boundaries we most want type checking.
- The policy would exist in two places: SQL and the service layer. Two
  implementations of an authorisation rule eventually disagree.

So: **one policy service, called explicitly, tested with negative paths as a
merge requirement.** The trade is that we own the discipline. The negative-path
helper set is what converts that discipline into something CI enforces.

## Data isolation today

Isolation is enforced at the point of *reading*, not by filtering afterwards:

```ts
const grants = await prisma.patientAccess.findMany({
  where: { userId, revokedAt: null, permissions: { has: 'viewProfile' } },
});
const patientIds = grants.map((g) => g.patientId);

// Every subsequent query carries `where: { patientId: { in: patientIds } }`.
```

Data the caller has no grant for never enters the result set, so it cannot be
leaked by a mapper that forgets to check. A revoked grant closes every surface
at once — the patient, their appointments, their rides and their live position
all disappear together on the next request.

## Roles, today

`OrgRole` is an enum with four members — `owner`, `admin`, `dispatcher`,
`member` — and `OrganizationsService.requireMembership` is the only place it is
checked, the organisation-axis counterpart to
`CareService.requirePermission`. Billing is `owner`/`admin`; the seat count and
ledger are readable by a `dispatcher`, because they are the person who adds
drivers and therefore the person the number is about.

Four enum members rather than `Role`/`Permission`/`RolePermission` rows: an
operator with a dozen staff does not need a permission editor, and the version
of this that is data is below.

## What Stage 5E adds

- **Organisation-scoped roles as data.** `Role` / `Permission` /
  `RolePermission` rows replacing the `OrgRole` enum, when an operator needs
  a permission an enum member cannot express.
- **SSO / SCIM**, which is also the point at which a managed identity provider
  genuinely pays for itself ([ADR-0003](../adr/0003-application-managed-auth.md)).
- **Cross-organisation referrals**, which is the first case where a patient is
  legitimately visible to two organisations at once — and the first real test
  of whether the model above holds.

## Deliberately deferred

- Per-tenant databases or schemas. At pilot scale this is operational cost with
  no benefit, and it forecloses the cross-organisation case above.
- Tenant-scoped encryption keys. Revisited if an enterprise customer requires
  it contractually.
- Postgres RLS. Revisited only if the application-layer discipline is shown to
  be failing — which the negative-path suite is designed to detect.
