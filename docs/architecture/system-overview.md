# System overview

## The shape

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  mobile-family   │  │  mobile-driver   │  │   ops-console    │
│    (Flutter)     │  │    (Flutter)     │  │  (Flutter Web)   │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │ HTTPS + WSS         │                     │
         └─────────────────────┴──────────┬──────────┘
                                          ▼
                            ┌─────────────────────────┐
                            │   ALB  (TLS, WAF)       │
                            └────────────┬────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │   NestJS modular monolith (ECS)       │
                     │  auth · patients · clinics ·          │
                     │  appointments · rides · dispatch ·    │
                     │  drivers · tracking · payments ·      │
                     │  notifications · audit · admin        │
                     │  REST (/api/v1) + Socket.IO + BullMQ  │
                     └───┬───────────────┬──────────────┬────┘
                         ▼               ▼              ▼
                 ┌──────────────┐ ┌────────────┐ ┌───────────┐
                 │ PostgreSQL   │ │   Redis    │ │    S3     │
                 │ source of    │ │ live loc,  │ │ documents │
                 │ truth, audit │ │ queues,    │ │ receipts  │
                 └──────────────┘ │ ws pub/sub │ └───────────┘
                                  │ idempotency│
                                  └────────────┘
                         │               │
                         ▼               ▼
                  Stripe · SES · FCM · Maps/Routing vendor
```

## Why each piece

### Flutter, for all three clients

One Dart codebase produces both apps for both platforms and — critically — the
ops console from the same models, client and design tokens. A three-surface
product built by a small team cannot afford three ecosystems.

Flutter's rendering model gives pixel-consistent large touch targets and
typography scaling, which matters more here than usual because the end user may
be 82 with a tremor. Mature first-party plugins exist for the two hard
requirements: maps and background location.

Accepted costs: Flutter Web's bundle size and weaker DOM accessibility — which
is exactly why patient-facing surfaces stay native and only the *internal*
console is web (R3) — and platform-channel work for the Android foreground
service.

State management is **Riverpod**, not Bloc.
See [ADR-0002](../adr/0002-riverpod-state-management.md).

### NestJS, as a modular monolith

We need one place that owns authorisation, the ride and appointment state
machines, driver assignment, payment state and the audit trail, because **no
client may be trusted with any of them.**

Guards and interceptors let authorisation, correlation IDs, audit and
idempotency be applied *by policy* rather than remembered per handler — the
single most common source of authorisation bugs. Decorator-driven OpenAPI gives
us the contract the Dart client is generated from. First-class WebSocket
support means live tracking is not a bolted-on second server.

See [ADR-0001](../adr/0001-modular-monolith.md).

### PostgreSQL, with Prisma

The data is a densely related transactional graph — user → patient →
appointment → ride → assignment → payment — and the invariants are exactly what
relational constraints exist to protect. Money and state transitions need real
transactions and `SELECT … FOR UPDATE`. Audit and consent need durable,
queryable, append-only history.

PostGIS is available when automatic matching justifies it, and deliberately not
before (T5). See [ADR-0007](../adr/0007-postgresql-prisma.md).

### Redis, for five jobs

Live location · WebSocket pub/sub · BullMQ queues · idempotency keys and
distributed locks · rate limiting and the ETA cache.

**Redis is a cache, never the source of truth.** If it is lost the system
degrades — live maps go stale, jobs pause — but no ride, payment or audit
record is lost. This is why `appointment_reminders` rows exist in Postgres and
the queue job is only a timer: a Redis flush must not silently cancel every
reminder in the system.

See [ADR-0008](../adr/0008-redis-bullmq.md).

### Every vendor behind an interface

Mail, push, maps and payments each sit behind a port with at least two
adapters, and which one is live is a single configuration decision resolved in
one module. Two consequences that are worth the indirection:

- A developer can run the entire product with no vendor accounts. The
  deterministic geocoder derives stable, plausible coordinates from address
  text; the log mail adapter prints subjects; the in-process scheduler replaces
  BullMQ.
- **Production refuses those adapters.** Config validation fails the container
  at boot rather than letting a system that silently succeeds while doing
  nothing reach a user — password resets that never arrive look exactly like
  nobody asking for one.

### AWS

Managed equivalents for every component we would otherwise operate, a signable
BAA covering the HIPAA-eligible services we use, and encryption at rest by
default via KMS. The deliberate constraint: **no AWS service enters the MVP
without a stated need.** No EKS, no Step Functions, no Kinesis.

See [ADR-0009](../adr/0009-aws-ecs.md) and [deployment.md](deployment.md).

## What is not here, and why

- **No API gateway product.** The ALB plus the application's own guards is
  sufficient at pilot scale and one fewer thing to configure incorrectly.
- **No message broker.** BullMQ over Redis covers every asynchronous need we
  have. A broker becomes interesting when a second service exists to consume
  from it.
- **No CDN in front of the API.** It serves JSON to authenticated clients.
