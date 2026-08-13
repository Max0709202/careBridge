# MVP scope

Five stages. Each ends in a working, reviewable state; none begins before its
predecessor's acceptance criteria are met.

---

## Stage 1 — Product foundation and architecture

Every piece of scaffolding needed to build features safely, and nothing else.

Documentation set · monorepo (pnpm + melos) · Docker Compose with Postgres,
Redis, Mailpit and MinIO · NestJS with validated config, redacting structured
logging, correlation IDs, one error envelope, health endpoints, OpenAPI,
graceful shutdown, BullMQ wiring, audit skeleton · Prisma with the identity
schema · Flutter workspace with shared packages · GitHub Actions CI.

**Acceptance:** `docker compose up` brings up a healthy stack; `/health`
returns 200; migrations apply to a clean database; `make check` passes; CI is
green on a pull request.

---

## Stage 2 — Core care coordination

A family member can register, create a patient, invite a relative, add a
clinic, and manage appointments — with authorisation and audit enforced and
*proven*.

Full auth lifecycle: email verification, refresh rotation with family
revocation, session listing and revocation, password reset, logout-everywhere,
TOTP-ready MFA scaffolding, consent records · patients, family links,
invitations, relationships and permissions · emergency contacts, addresses,
mobility requirements · clinics with geocoding behind the maps interface ·
appointments with a status machine, history and timezone-correct reminders ·
notification centre with email and push and per-channel preferences.

**Acceptance:** every brief criterion, plus — an unauthorised user receives an
*indistinguishable* response for "not found" and "not permitted"; every
mutation writes an audit row; no personal data appears in any log line.

---

## Stage 3 — Transportation, dispatch and live tracking

The differentiator, and the highest-risk stage in the plan.

Driver onboarding with documents to S3 via pre-signed URLs, admin approval,
vehicles with accessibility attributes, availability · ride requests with
estimates · dispatch queue, manual assignment, reassignment with recorded
reason, delay and no-show handling · the driver's full transition sequence ·
Socket.IO gateway with authenticated handshake and per-room authorisation ·
Redis current-position store and pub/sub, sampled persistence, retention job ·
adaptive-cadence location with offline queue · ETA with cache and circuit
breaker · staleness watchdog · `ops_console` (Flutter Web).

**Acceptance:** location writes stop within seconds of completion and are
rejected thereafter; a stale position is visibly marked in every client; a
driver killing the app mid-ride does not corrupt ride state; a documented
manual field test on real devices.

---

## Stage 4 — Payments, subscriptions, operations

Commercially operable and safe to run a controlled pilot on.

Stripe: customer, SetupIntent, authorise at assignment, capture at completion,
failure and retry, refunds, receipts, signed webhooks with idempotency,
reconciliation, internal ledger · subscriptions with entitlement checks · admin
surfaces including the audit-log viewer · Terraform for staging and production
· deploy pipeline with migration step and documented rollback · backup and a
**tested, timed** restore · rate limiting and idempotency keys · an OWASP API
Top 10 pass and a load test of the tracking path.

**Acceptance:** a restore from backup is *performed and timed*, not merely
documented; every sensitive administrative action appears in the audit viewer;
no compliance claim appears anywhere in code, copy or docs.

---

## Stage 5 — Expansion, gated on pilot evidence

Not begun until pilot metrics justify it. **5A** caregiver marketplace · **5B**
clinic portal and integrations · **5C** AI coordination assistant, logistics
only · **5D** route optimisation, recurring rides, PostGIS · **5E** read
replicas, data warehouse, SSO/SCIM, SLOs, multi-region.

See [non-goals.md](non-goals.md) for the hard rules on 5C.
