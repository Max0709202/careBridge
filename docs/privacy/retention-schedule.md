# Retention schedule

Enforced by a scheduled job, **not by intention**. The distinction matters: a
retention policy that lives only in a document is a statement about what we
would like to be true.

Implementation: `apps/api/src/modules/retention/retention.service.ts`.

## The schedule

| Data | Retained | Why that number | Enforced by |
| ---- | -------- | --------------- | ----------- |
| Ride location samples | **30 days** | Long enough to resolve a dispute about a specific journey; short enough that we are not accumulating a movement history | Retention job |
| Notifications | 90 days | Read or not, a notification stops being useful long before this | Retention job |
| Credential tokens (verification, reset) | Until expiry | An expired single-use token has no further use | Retention job |
| Unaccepted invitations | 30 days past expiry | No evidentiary value once long dead | Retention job |
| Device tokens | 180 days without a check-in | FCM rotates tokens on its own schedule and does not always tell us when one dies; age is the only signal for a device that simply stopped checking in | Retention job |
| Revoked / invalidated device tokens | Immediately eligible | — | Retention job |
| **Audit logs** | **7 years** | Regulatory and dispute exposure | **Never deleted by any job.** Append-only, no update or delete path exists in the application |
| Soft-deleted patients | Grace period, then purge | Audit and dispute resolution need the record to survive the deletion request | Stage 4 |
| Payment records and ledger | 7 years | Financial regulation | Stage 4 |
| Support attachments | Per policy | | Stage 5 |
| Backups | Per RPO/RTO — 30 days of RDS snapshots | [../architecture/disaster-recovery.md](../architecture/disaster-recovery.md) |

## How the job behaves

- **Daily.** Windows measured in weeks do not need a tighter cadence.
- **Each step is failure-isolated.** A locked table or a slow delete in one
  must not stop the others — a single failing sweep quietly halting every
  retention window at once is the failure mode to avoid.
- **It re-arms itself** rather than relying on a repeatable-job feature that
  only one of the two queue adapters has. One mechanism, both drivers.
- **It never touches the audit log.** There is no code path in the application
  that deletes one.

## Account deletion

Implemented 2026-09-17 — [ADR-0013](../adr/0013-account-deletion.md) is the
per-relation policy, `domain/account-deletion.ts` is that policy as code, and a
test reads `schema.prisma` and fails if a relation on `User` has no disposition.

Requested in the app or at a public URL, scheduled 30 days out, cancelled by
signing in, and executed by the retention sweep below. On request, the account
holder receives an export, then:

- Data we are not required to keep is **deleted**.
- Data that audit or financial regulation requires us to keep is
  **anonymised** — the audit row survives, the identity attached to it does
  not.

The distinction is the point: "delete my account" cannot mean "delete the
record that a payment happened", and saying so plainly is better than a
deletion that quietly does not.

A patient whose last caregiver was the person leaving is archived immediately
and scrubbed 30 days later — so a patient's data outlives the account by up to
sixty days in total. That is deliberate: the patient has no account, and once
the last grant is gone nobody can ask for any of it back on their behalf. The
patient *row* survives the scrub, because `Ride.patientId` cascades and
removing it would delete every completed journey and its fare.

## What is deliberately not retained at all

- Full dates of birth — never collected.
- Clinical data of any kind — never collected.
- Card numbers — never touch our servers.
- Every location point — only a ~30-second sample plus state transitions.
