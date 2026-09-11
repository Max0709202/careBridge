# ADR-0013 · Account deletion erases a person, not the record that events happened

**Status:** Proposed · **Date:** 2026-09-11 · **Implemented:** not yet — this
record exists so that the implementation is a mechanical exercise rather than a
series of decisions made at a keyboard

## Context

There is no way to delete an account. Not in the app, not in the API, not by
asking — `docs/privacy/retention-schedule.md` describes the intended behaviour
under "Account deletion" and marks it Stage 4, and nothing implements it.

That is now the single thing standing between this product and a store listing:

- **Apple, Guideline 5.1.1(v).** An app that supports account creation must
  support account deletion *from inside the app*. A support email address is
  explicitly not sufficient.
- **Google Play.** Requires an in-app path *and* a publicly reachable web URL
  where deletion can be requested without installing the app.

It is also, independently, a GDPR Article 17 obligation and the thing a family
will ask for first when they stop using the service — which is a moment that
arrives, in this product's domain, when somebody has died.

The naive implementation is `DELETE FROM users WHERE id = ?` with cascades, and
it is wrong in both directions at once. It destroys records that regulation
requires us to keep — the audit log is append-only for seven years and payment
records for the same — and it does *not* destroy things that have nothing to do
with the deleted account but hang off it by a foreign key, such as a patient
whose only remaining caregiver is the person leaving.

## Decision

**Deletion means the person becomes unidentifiable, not that history becomes
untrue.** Three dispositions, applied per relation, and every relation on
`User` gets one explicitly — a relation with no listed disposition is a bug,
not a default.

**Delete** — data whose only purpose was serving this user:

| Relation | Note |
| --- | --- |
| `refreshTokens`, `credentialTokens`, `mfaEnrolment` | Credentials. Removing them is most of what "delete my account" means to the person asking. |
| `deviceTokens`, `notificationPreferences`, `notifications` | Nothing here has evidentiary value, and a push token that outlives its account is a message to a stranger's phone. |
| `idempotencyRecords` | Hashes of requests nobody will repeat. |
| `access` (`PatientAccess`) | The grant goes. Whether the *patient* goes is the question below. |
| `invitationsSent` that are unaccepted | An accepted invitation is history; an unaccepted one is a live capability and must not outlive the inviter. |

**Anonymise** — the row survives, the identity attached to it does not. The
foreign key is repointed at a single tombstone user per deletion, carrying no
name, no email, no phone:

| Relation | Why it cannot simply go |
| --- | --- |
| Audit rows | Append-only for seven years. `docs/privacy/retention-schedule.md` says no application code path deletes one, and this is not the exception. |
| `billingAccount`, invoices, payments, `seatChanges` | Seven years, financial regulation. "Delete my account" cannot mean "delete the record that a payment happened". |
| `driversApproved`, `documentsReviewed`, `refundsRequested`, `flagsChanged`, `disputesResolved` | These say *a platform administrator did something*. The act is the record; the administrator's identity is not what makes it meaningful, and an approval that loses its actor is still an approval that happened. |
| `invitationsAccepted` | How an existing grant came to exist. |
| Completed rides and their fares | A ride that happened, happened. The addresses on it are already snapshots per leg. |

**Refuse, and say why** — states where deletion is not a data question:

| State | Response |
| --- | --- |
| A ride is in flight | Somebody is in a car right now. Deletion waits for the trip, and the message says so. |
| The account is the last `owner`-level member of an `Organization` with active drivers | Deleting it orphans a fleet. The operator must transfer ownership first. |
| An unpaid invoice inside its grace window | Not a debt-collection mechanism; an explicit decision to write it off is a different action, taken by a person. |

### The patient question, decided

A patient is not a user and has no account. When the last `PatientAccess` grant
on a patient is removed by a deletion, **the patient is soft-deleted and purged
after a 30-day grace period** — not deleted immediately and not left orphaned.

Immediately is wrong because the most common reason a last caregiver leaves is a
mistake or a family argument, and the second most common is bereavement, which
is not a moment to make irreversible. Orphaned is wrong because a patient row
carries a home address and mobility needs and would sit there reachable by
nobody and deletable by nobody.

### The shape of the operation

1. **Export first, then delete.** The account holder receives their data before
   it goes. A deletion with no export is a deletion the person cannot check.
2. **A 30-day grace period**, cancellable by signing in. Deletion requests in
   this product's domain are made by people having a bad week.
3. **Sign out everywhere immediately** — `tokenVersion` is bumped on request,
   not on execution, so the decision takes effect on every device at once.
4. **Executed by the retention sweep**, not by the request. A sweep cannot be
   forgotten, for the same reason the notification outbox and the billing cycle
   are sweeps: a job scheduled at request time can be lost by a restart.
5. **The deletion is itself audited**, and that row is one of the ones that
   survives.

## Alternatives rejected

**Hard delete with database cascades.** One statement, and the cascade decides
policy by whatever `onDelete` happens to be written on each relation — which
means the policy is distributed across twenty-five schema lines nobody reads
together, and a new relation gets whatever its author typed. It also deletes
audit and payment rows, which is illegal before it is unwise.

**Soft delete only — set a flag and hide the row.** The account stops working
and every piece of personal data is still there. This satisfies the store
requirement and not the promise, and it is the version that becomes a headline.

**Deletion on request by email.** What exists today, and it is what both stores
specifically refuse to accept.

## Consequences

A `deletionRequestedAt` on `User`, a tombstone user per deletion, a
`DELETE /auth/account` that schedules rather than executes, a cancel path, an
export, and a sweep step in `RetentionService` that already has the shape for
it. The web URL Play requires can be a page on the marketing site that submits
the same request.

## What would make us revisit

A jurisdiction that requires deletion faster than 30 days, which would make the
grace period a compliance problem rather than a kindness. Or evidence from the
pilot that people use the grace period to cancel — which would be an argument
for making it longer, not shorter.
