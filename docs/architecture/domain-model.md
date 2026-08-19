# Domain model

## Conventions

- UUID primary keys; time-ordered where the volume justifies it.
- `created_at` / `updated_at` on every table.
- `timestamptz` in UTC everywhere, with the **IANA zone stored beside** any
  user-facing time. A UTC offset is not a zone and is wrong twice a year.
- Soft delete only where audit or regulation demands it — patients,
  appointments, rides. Hard delete elsewhere.
- `version` columns for optimistic locking on rides and appointments.
- Money as **integer cents**. Never a float, never a decimal string.

## The relationship that carries authorisation

```
User ──< OrganizationMembership >── Organization ──< Driver ──> Vehicle
User ──< PatientAccess >────────── Patient          ← every patient-scoped
                                     │                authorisation check
                                     ├──< EmergencyContact
                                     ├──< PatientAddress
                                     ├──< MobilityRequirement
                                     ├──< PatientInvitation
                                     └──< Appointment ──> Clinic
                                              │              │
                                              │              └──> Address (geocoded)
                                              ├──< AppointmentReminder
                                              └──< Ride ──< RideAssignment ──> Driver ──> Vehicle
                                                     ├──< RideStatusHistory
                                                     ├──< RideEvent
                                                     ├──< RideLocationSample  (30-day retention)
                                                     └──< Payment ──< Refund

User ──── BillingAccount ────< Subscription ──> SubscriptionPlan ──< SeatTier
             │  (or)                 ├──< SubscriptionPeriod   (append-only)
Organization ┘                       └──< SeatLedgerEntry      (append-only)
```

**A billing account belongs to exactly one of the two payers.** `ownerUserId`
and `organizationId` are both nullable and both unique, with a database CHECK
that exactly one is set — a shape the type system cannot narrow and the database
can.

**Authorisation for a ride is never asked directly.** It resolves *up* the
graph — ride → patient → `PatientAccess`, or ride → assignment → driver, or
ride → provider → `OrganizationMembership`. One traversal, one implementation,
in `CareService.requirePermission`. A ride id is not a capability.

## Entities that carry a design decision

### `Patient`

Preferred name **required**, legal name **optional**, and **no date of birth
anywhere**. An optional coarse `age_band` covers genuine mobility planning. See
[../product/non-goals.md](../product/non-goals.md).

### `PatientAccess`

The central authorisation edge. Unique on `(userId, patientId)` — there is only
ever one edge, and its history is the audit log. `grantedByUserId` is null for
the organiser who created the patient record; they keep `manageAccess`
unconditionally, or a family could lock itself out of its own patient with no
recovery short of support.

`viewProfile` is the floor every other permission stands on: a grant that can
schedule but not see the person is not a coherent thing to offer, and the
snapshot query filters on it.

### `PatientInvitation`

Single-use, expiring, **email-bound**, stored as a digest. Three properties,
each enforced against a specific attack — see
[security-model.md](security-model.md#invitations).

### `Driver`

Has a lifecycle of its own — `invited` → `pendingApproval` → `approved`, with
`suspended` and a terminal `offboarded` — and it is the **operator's billing
meter**: a driver occupies a billable seat exactly while they are `approved`.
One definition (`occupiesSeat` in src/domain/driver-status.ts), turned into SQL
in exactly one query. A second predicate somebody has to keep in step ends with
an operator billed for drivers they offboarded in March.

`onShift` is deliberately separate. Whether somebody is working today changes
several times a day; whether the company has said they may carry a passenger
does not, and conflating them means a suspension can be undone by a scheduling
screen.

Offboarded rather than deleted, because a completed ride from March still has to
name the person who drove it.

### `Subscription`

At most **one live subscription per billing account**, enforced by a partial
unique index over the non-terminal statuses. Prisma cannot express a partial
index, so it is hand-written in the migration. Without it "which subscription
is in force" has more than one answer, and an entitlement check starts
depending on row order.

There is no edge out of `canceled` or `expired`. Re-subscribing creates a new
row, so what somebody was charged, under which plan version, stays immutable.

### `SubscriptionPeriod`

Append-only, and it **copies** the plan code, version, interval and itemisation
rather than joining to them. A plan row can be deactivated or superseded; the
period has to keep saying what it actually charged. Same mechanism as
`PricingRule.version` on a ride, and the same reason.

### `SeatLedgerEntry`

Append-only record of a driver taking or releasing a billable seat. It is what
makes "why were we billed for eleven drivers in June" answerable, given that
the `drivers` table has changed since. A grant carries the proration charged
for the remainder of the period; a release carries zero, because a released
seat stays usable until the period that paid for it ends.

Drivers are offboarded rather than deleted for the same reason: an invoice for
eleven seats has to be answerable with eleven names, including the two who left
in July. `Driver.deactivatedAt` records *when* they stopped occupying one;
`Driver.status` is what decides whether they do.

`Subscription.seatsPaidFor` is the high-water mark for the current period, and
proration is measured against it rather than against the head count — so a
driver suspended and reinstated in one month is not charged for twice. It resets
at renewal, which is the moment a reduction actually takes effect.

### `RefreshToken`

Grouped by `familyId`, which is stable for the life of one sign-in. Individual
tokens rotate every few minutes; the family is what a person recognises in a
session list and what they can revoke. Presenting a rotated token revokes the
whole family.

### `Ride`

A round trip is **two rides sharing `roundTripGroupId`**, not one ride with two
legs — because each leg is independently assigned, tracked, cancelled and
priced.

There is deliberately **no `delayed` status**. A driver stuck in traffic on the
way to pickup is still `driverEnRoute`; delay is a *flag*, so it can be raised
and cleared without losing the state the ride must return to.

### `AppointmentReminder`

One row per scheduled reminder, written in the same transaction as the
appointment. The **row is the record of intent and the queue job is only the
timer**: Redis may be lost, and if the queue were the only record a flush would
silently cancel every reminder in the system. Unique on
`(appointmentId, offsetMinutes)`, which is what makes rescheduling idempotent.

### `Notification` and `NotificationDelivery`

Split because "the family was told" and "the email provider accepted it" are
different facts, and a support conversation about a missed ride needs both.
`suppressed` is a first-class delivery outcome, not a failure — a user who
turned email off did not have a delivery problem.

Notification bodies carry **no patient name, clinic name, address or time.**

### `PricingRule`

Prices are configurable records, never constants in code, and the version is
stored on the ride — so a charge from eight months ago can still be explained
by the rule that produced it.

### `AuditLog`

Append-only: no update or delete path exists in the application. Records actor,
role, action, entity, organisation, correlation id, IP and user agent. Changed
**field names** are recorded; changed **values** are not — knowing that a phone
number was edited is what an investigation needs, and storing the old and new
number would make the audit log a second copy of the data it exists to protect.

Audit writes participate in the same transaction as the change they describe,
so an audited action cannot succeed unaudited.

## Sensitivity classification

Every table carries one, and it drives log redaction and retention. See
[../privacy/data-map.md](../privacy/data-map.md).
