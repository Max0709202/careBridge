# ADR-0008 · Redis and BullMQ, with Redis as a cache only

**Status:** Accepted · **Date:** 2026-07-27

## Context

Five distinct needs: live location, WebSocket pub/sub, background jobs,
idempotency keys and distributed locks, and rate limiting plus an ETA cache.

## Decision

**One Redis**, serving all five, and **BullMQ** for the queues.

And the constraint that governs everything else here:

> **Redis is a cache, never the source of truth.**

## What that constraint actually buys

If Redis is lost, the system degrades — live maps go stale, jobs pause — but no
ride, payment or audit record is lost. That is only true because of specific
design choices, not by hope:

| Concern | Where the durable record lives |
| ------- | ------------------------------ |
| Reminders | `appointment_reminders` rows. The queue job is **only a timer**; `rehydrate()` re-arms every pending row at boot |
| Notification delivery | The `Notification` row, written in the originating transaction. An outbox sweep re-enqueues anything with no delivery rows |
| Webhook idempotency | `webhook_events`, with a unique constraint on the provider event id |
| Live position | Nowhere durable, deliberately — plus a sampled subset in Postgres for dispute resolution |

Had the queue been the only record of a reminder, a Redis flush would silently
cancel every reminder in the system and nobody would find out until a patient
missed an appointment.

## The second adapter

`QueuePort` has two implementations: `BullMqQueueAdapter` and
`InProcessQueueAdapter` — `setTimeout` pretending to be a queue.

The in-process one is honest about what it is not: nothing survives a restart,
two processes double-fire, and a far-future delay is scheduled in hops because
Node's timers cap at ~24.8 days. **Production refuses it** by config
validation.

It exists so that `git clone && pnpm start:dev` works without Docker, which is
worth a lot on somebody's first day — and it is *safe* to exist only because
the database is the record of intent.

## Alternatives

**SQS + EventBridge.** Managed, durable, and three more AWS services plus a
local-development story that needs emulation. Rejected under "no AWS service
without a stated need".

**pg-boss (queues in Postgres).** One fewer dependency, and it puts
high-frequency queue polling on the database that is already the source of
truth. We need Redis for live location regardless, so the marginal cost of
using it for queues is zero.

**A separate Redis per concern.** Operational cost with no benefit at pilot
scale.

## Consequences

- Jobs are idempotent by construction: the job id is derived from the entity id
  (`reminder:{id}`, `notify:{id}`), so a retried enqueue is a no-op and several
  instances sweeping the same outbox collapse into one job.
- BullMQ needs `maxRetriesPerRequest: null` on its connection, because a
  blocking pop legitimately sits open for minutes.
- Workers run in the API process today. The seam to split them is the port, so
  a worker-only process is a different bootstrap rather than a refactor.

## Revisit when

- Queue depth affects request latency — the signal to split the worker process.
- A second service needs to consume the same events, which is when a broker
  becomes interesting.
