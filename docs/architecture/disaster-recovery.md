# Disaster recovery

## The commitment that makes this document worth anything

> A restore from backup is **performed and timed**, not merely documented.

This is a Stage 4 acceptance criterion. An untested restore is not a recovery
plan; it is a paragraph.

## Objectives

| Store | RPO | RTO | Basis |
| ----- | --- | --- | ----- |
| PostgreSQL | 5 minutes | 1 hour | Automated backups plus point-in-time recovery |
| Redis | **Total loss acceptable** | Minutes | It is a cache. Nothing durable lives there |
| S3 | Effectively zero | Minutes | Versioning enabled; cross-region replication in Stage 4 |

## What is actually at risk

Redis being a cache is a design position, held deliberately, and it is what
makes the table above tolerable:

| If Redis is lost | Consequence | Recovery |
| ---------------- | ----------- | -------- |
| Live positions | Maps go stale; clients show "last seen" | The next point from the driver |
| Queued jobs | Reminders and notification deliveries pause | `RemindersService.rehydrate()` re-arms from the database at boot; the notification outbox sweep re-enqueues anything without delivery rows |
| Idempotency keys | A replayed webhook could double-process | `webhook_events` has a unique constraint on the provider event id — the *database* is the idempotency guarantee, not Redis |
| Rate-limit counters | Limits reset | Acceptable |

**No ride, payment or audit record is lost**, because none of them live there.

## Backups

- **RDS**: automated daily snapshots, 30-day retention, PITR within the
  window. Encrypted with KMS.
- **S3**: versioning on; lifecycle policy per the retention schedule;
  cross-region replication for driver documents and receipts.
- **Secrets Manager**: versioned by the service.
- **Infrastructure**: Terraform state in S3 with DynamoDB locking. The
  infrastructure is reproducible from the repository.

## Restore drill

Quarterly, and after any change to the backup configuration.

1. Restore the most recent snapshot to a **new** RDS instance.
2. Point a staging task at it.
3. Run migrations — they must be a no-op.
4. Verify: a known appointment loads; a ride timeline reconstructs; the audit
   log is intact and its most recent entry is inside the RPO window.
5. **Record the wall-clock time from step 1 to step 4.** That number is the
   real RTO. The one in the table is a target until a drill produces it.
6. File the result in `docs/runbooks/`, including anything that went wrong.

A drill that goes perfectly and is not written down has taught nobody anything.

## Scenarios

### Corrupt or destructive migration

Forward-only schema changes mean there is no down-migration to run. The path
is: stop writes, PITR to immediately before the migration, apply a corrected
migration, resume. The rehearsal above is what makes this a procedure rather
than an improvisation.

### Region failure

Out of scope for the pilot (L4: US-only, single region). RDS Multi-AZ covers
an availability-zone failure. Multi-region is Stage 5E, and it is a cost
decision as much as an engineering one.

### Data-deletion incident

The audit log is append-only with no update or delete path in the application,
so the record of *what happened* survives an incident affecting the data it
describes. That is the property that makes an investigation possible.

### Vendor outage

| Vendor | Degradation | Not affected |
| ------ | ----------- | ------------ |
| SES | Emails queue and retry | In-app notifications; the timeline |
| FCM | Push fails; delivery rows record it | In-app notifications |
| Maps / routing | ETA unavailable; positions still stream | Tracking itself |
| Stripe | New authorisations fail | Rides in progress; the ledger |

Every one of these is a *degradation* rather than an outage, and that is a
direct consequence of the port-and-adapter boundary: the failure is contained
to the channel, and the delivery record says which channel failed.
