# CareBridge — Foundation Document

**Status:** Draft for approval · **Date:** 2026-07-27 · **Author:** Founding engineering
**Supersedes:** the Phase 1–2 Next.js prototype at commit `bfeb0bc` (retained in git history only)

This document is the gate before any application code is written. It records what
we understand the problem to be, what we are assuming, what the MVP is and is not,
the architecture and why, the five-stage plan, the domain model, the API surface,
the repository layout, the security and privacy plan, and the exact first twenty
implementation tasks.

---

## Decisions already taken (inputs to this document)

Four decisions were made before drafting and are treated as settled:

| # | Decision | Consequence |
| - | -------- | ----------- |
| D1 | **Greenfield.** The working tree was deliberately emptied; the prior Next.js + Drizzle + Supabase build stays in git history as reference only. | No migration burden. We may still mine `bfeb0bc` for its ADRs, privacy data map and threat model — that thinking was sound and is cheaper to port than to redo. |
| D2 | **Mobile-only clients.** Two Flutter apps: family/patient and driver. | No Next.js web portal in the MVP. Dispatcher and admin need a surface — see the Dispatcher Gap below. |
| D3 | **NestJS modular monolith** is the backend of record. | Server owns auth, state machines, assignment, payments and audit. Clients are never trusted. |
| D4 | Two separate app targets, not one role-switching app. | The driver's background-location entitlement stays off the family app's install, which matters for store review and for user trust. |

### The Dispatcher Gap — the one open scope question

Journey 5 and the Stage 3 acceptance criteria require a dispatcher to see a queue,
assign a driver, watch a live map and reassign. That is a dense, multi-pane,
keyboard-driven screen. It is the worst possible fit for a phone, and D2 removes
the web portal.

Three ways out, in order of preference:

1. **Flutter Web `ops-console` target** *(recommended)* — a third target in the same
   Flutter workspace, reusing the same generated API client, models and design
   tokens. Internal-only, behind auth, no SEO or first-paint requirements, small
   known audience on desktop Chrome. This honours "no separate web stack" while
   giving dispatchers a real screen. Cost: Flutter Web's large initial bundle and
   weaker text/DOM accessibility — acceptable for an internal tool, not for
   patient-facing pages.
2. **Rules-based auto-assignment only in the MVP**, with dispatcher actions exposed
   as authenticated REST endpoints and driven by operations staff through an API
   client until a console exists. Ships fastest; unrealistic for a real transport
   operation, which is exactly why the brief calls dispatchers out.
3. **Tablet-optimised ops mode inside the driver app.** Cheapest, but it puts
   operations tooling and background-location permissions in one binary. Rejected
   for the same reason as D4.

**Proposal:** auto-assignment plus REST endpoints in Stage 3, `ops-console`
(Flutter Web) delivered at the end of Stage 3. Flagged as risk R1.

**Resolved.** The REST endpoints and the console are both built. Assignment is
still manual — a dispatcher picks from a queue the server has ordered and
filtered — and auto-assignment remains future work that will rank candidates
`driverEligibility` has already filtered, rather than replacing it.

---

# Section 1 — Understanding of CareBridge

## The problem

An adult child, two states away, gets a call: Mum has a cardiology follow-up on
Thursday at 10:40. She no longer drives. What follows is not a medical problem —
it is a logistics problem that no single system owns:

- Call the clinic to confirm the slot and how long it will run.
- Call a non-emergency medical transport company. Explain the walker, the
  wheelchair, the fact that she cannot manage stairs unassisted.
- Book the return leg without knowing when the appointment will actually end.
- On Thursday morning, wait. Was she collected? Did the driver arrive at all? Did
  she get inside the building? Call her mobile; she does not hear it in her bag.
  Call the transport company's dispatch line and hold.
- Pay three separate parties, none of whom talk to each other.

The failure is **informational**, not clinical. Every party holds one fragment of
the truth and none of them holds the whole picture: the clinic knows the slot, the
transport company knows the driver, the driver knows where the car is, the family
knows nothing at all. The distress that drives churn in this market is not a
missed appointment — it is the two hours of silence in the middle of a workday.

CareBridge's product is **the removal of that silence.**

## Target users

| User | Who they are | What they need | Where they are |
| ---- | ------------ | -------------- | -------------- |
| **Family member** | 45–65, working, often remote, coordinating for a parent. The buyer and the daily active user. | Certainty. Fewer phone calls. Proof of what happened. | Family app |
| **Patient** | 70+, may have low vision, tremor, hearing loss, mild cognitive impairment. | To know who is coming, when, and in what car. Nothing else. | Family app, simplified mode |
| **Driver** | Contract or employed NEMT driver, phone mounted, gloves on, running late. | The next task, one tap, no reading. | Driver app |
| **Dispatcher** | Operations staff at a transport provider, 40–200 rides a day. | Density. Exceptions surfaced. Fast reassignment. | ops-console |
| **Clinic staff** | Front desk. Cares about arrival times and no-shows. | Who is coming, are they late. | Post-MVP |
| **Caregiver** | Non-medical companion. | Post-MVP. | Post-MVP |
| **Administrator** | Us. | Approve drivers, resolve disputes, read audit. | ops-console |

The family member is the **payer**, the patient is the **beneficiary**, and the
driver is the **data source**. All three must be served or the loop does not close.
This split is the single most important structural fact about the product.

## Core value proposition

> One place to arrange an elderly relative's appointment and the ride to it — and
> live proof, minute by minute, that it is actually happening.

Adjacent products solve fragments: NEMT brokers move people but tell families
nothing; consumer rideshare tracks well but cannot handle a wheelchair, a
scheduled pickup or a passenger who needs an arm to lean on; caregiver
marketplaces staff visits but ignore transport. The defensible position is the
**join** between them, held by an audited event timeline.

## Main workflows

1. Family registers → creates a patient profile → records mobility needs and an
   emergency contact.
2. Family records an appointment (clinic, date, time, expected duration).
3. Family requests transport against that appointment — one-way or round trip.
4. Dispatch (or a rule) assigns a driver; family is notified with the driver's
   name, photo and vehicle.
5. Driver executes: en route → arrived → passenger onboard → in progress →
   arrived at destination → completed. Each transition is server-validated.
6. Family watches on a live map and receives a notification per transition.
7. Payment is authorised at assignment and captured at completion.
8. Everything lands in a timeline the family can read back later.

## Why transportation tracking matters

It is the only feature that converts an *administrative* product into an
*emotional* one, and emotional products retain.

Concretely, the live map does four things a status list cannot:

- **It replaces a phone call.** Every avoided call to dispatch is a cost saved on
  both sides.
- **It bounds anxiety.** "Driver is 6 minutes away" is a finite, tolerable wait.
  "No update since 09:12" is not.
- **It produces evidence.** No-show disputes, late-pickup complaints and refund
  requests are all resolved by the same event log — which is also the audit trail
  a regulator or an enterprise customer will ask to see.
- **It is the wedge into the operator.** Transport companies adopt CareBridge
  because *their* customers stop calling them, not because they wanted new
  software.

The corollary, which we design for from day one: **tracking must be honest.**
A stale position rendered as a confident moving car is worse than no map at all,
because it manufactures false certainty about a vulnerable person. Every location
surface carries a freshness age, degrades visibly when GPS accuracy is poor, and
says "last seen 3 minutes ago" rather than interpolating a plausible lie.

## Why the family dashboard matters

It is where the product is *bought*, *renewed* and *judged*. The driver app is
infrastructure; the ops console is a cost centre; the family home screen is the
only screen anyone chooses to open. It must answer, above the fold and without
interaction: **What is next? Is it on track? What do I do if it is not?**

## Why this begins as a coordination platform

Three reasons, in order of weight:

1. **Regulatory surface.** Coordination data (name, address, phone, appointment
   time, mobility needs) is sensitive but bounded. The moment we store diagnoses,
   medications or clinical notes we become an EHR-adjacent system, with the BAAs,
   audits and breach exposure that follow. We take that step deliberately and
   late, not by accident.
2. **The value is real without clinical data.** Nothing in Journeys 1–6 requires
   knowing *why* the patient is seeing a cardiologist.
3. **Coordination is a data-network position.** Owning the appointment/ride/
   payment graph makes caregiver, clinic and insurance layers natural extensions
   later. Starting at any of those layers makes the coordination layer a
   retrofit.

---

# Section 2 — Assumptions

Each is stated so it can be falsified. Assumptions marked **⚠** would force a
design change if wrong.

### Product

| ID | Assumption |
| -- | ---------- |
| P1 | Families, not patients, are the primary account holders and payers. |
| P2 | ⚠ Appointments are **recorded** in CareBridge, not booked into a clinic system. No EHR/scheduling integration exists in the MVP. |
| P3 | Patients frequently cannot or will not install an app. The family app must work fully with the patient never touching it. |
| P4 | Return-leg timing is inherently uncertain; "flexible return" is a first-class concept, not an edge case. |
| P5 | Round trips are the common case, not the exception. |
| P6 | ⚠ Simplified patient mode is a mode within the family app, not a third binary. |
| P7 | Wheelchair-accessible vehicle requirement is a hard constraint on assignment, never a preference. |

### Technical

| ID | Assumption |
| -- | ---------- |
| T1 | Driver phones have intermittent connectivity. The driver app must queue state transitions and location points and reconcile on reconnect. |
| T2 | ⚠ Foreground-service location (Android) plus while-in-use (iOS) is sufficient for v1. We avoid the iOS "Always" entitlement until a real trip proves we need it. |
| T3 | Ride volume in the pilot is under ~500/day, so a single API instance plus Redis is ample. No sharding, no read replicas. |
| T4 | Sub-second location latency is not required. 5-second cadence while moving is well inside the useful range. |
| T5 | ⚠ PostGIS is not needed in the MVP. Driver–pickup proximity at pilot scale is a bounding-box query plus in-process distance. Adopt PostGIS when matching becomes automatic. |
| T6 | One map/routing vendor covers maps, geocoding and ETA. Vendor calls sit behind an interface so it can be swapped. |
| T7 | An OpenAPI spec generated from NestJS is the single contract; the Dart client is generated from it, never hand-written. |
| T8 | Push via FCM covers both platforms (FCM → APNs for iOS). |

### Operational

| ID | Assumption |
| -- | ---------- |
| O1 | The pilot runs with one transportation provider in one metro area, one timezone. |
| O2 | Human dispatchers exist and are the assignment authority. Automation assists; it does not replace. |
| O3 | Driver onboarding — identity, licence, insurance, background check — happens **off-platform**. We record status and documents; we do not verify. |
| O4 | Support is a human inbox in the MVP, not a ticketing product. |
| O5 | Business hours operations. No 24/7 on-call in the pilot. |

### Legal / compliance

| ID | Assumption |
| -- | ---------- |
| L1 | ⚠ CareBridge is most likely a **business associate** when contracted by a covered entity, and possibly neither when contracted directly by a family. This must be settled by counsel before pilot. Architecture assumes the strictest case. |
| L2 | We will never describe the product as "HIPAA compliant" — only "HIPAA-ready architecture" — until legal, contractual and operational review is complete. |
| L3 | BAAs must be executed with AWS, the email vendor, the SMS vendor and any AI vendor before real patient data flows. Stripe is out of scope for PHI by design. |
| L4 | Data residency is US-only in the MVP. |
| L5 | Terms, privacy policy and consent copy are placeholders pending legal review, but the **consent recording mechanism** is real from Stage 2. |

### Business

| ID | Assumption |
| -- | ---------- |
| B1 | Revenue is **two subscriptions**: a family household plan, and a dispatch operator plan priced by drivers on the road. Both are monthly or annual, both are configurable records, never constants in code. Superseded the original "family subscription plus a per-ride margin" — see [ADR-0011](adr/0011-two-sided-subscription-billing.md). |
| B1a | The per-ride platform margin applies **only** to operators who are not on a subscription. An operator paying by seats keeps the whole fare; charging both would be charging twice for one relationship. |
| B2 | Transportation is fulfilled by partner providers; CareBridge does not own vehicles or employ drivers in the MVP. |
| B3 | ⚠ No insurance, Medicaid or Medicare billing. Families pay by card. This is the single largest constraint on early market size and is accepted knowingly. |
| B4 | Pricing is distance-and-time based with accessibility and wait-time surcharges. |

---

# Section 3 — MVP scope

## Required for MVP

**Identity & access** — registration, email verification, login, argon2id hashing,
short-lived access tokens, rotating refresh tokens, logout (device and all
devices), session listing, password reset, role assignment, TOTP-ready MFA
scaffolding, consent recording, account deactivation.

**Patients & family** — create/edit/archive patient; link family members by
invitation; relationship type; per-relationship permission set; emergency
contacts; addresses; mobility requirements; accessibility and communication
preferences; access history.

**Clinics** — create, edit, search, archive; multiple locations; address
validation and geocoding; coordinates persisted.

**Appointments** — create, edit, reschedule, cancel; linked to patient and clinic;
expected duration; non-clinical coordination notes; reminder rules; status machine
with full history; list and calendar views.

**Transport** — ride request from an appointment or standalone; one-way and round
trip; flexible return; pickup/destination with coordinates; assistance
requirements; wheelchair requirement; distance/duration/price estimate;
cancel and reschedule with reason; full status machine and timeline.

**Dispatch** — unassigned queue, driver availability, manual assignment,
reassignment with recorded reason, delay and no-show handling, internal notes,
active-ride map, alert centre. Delivered via API in Stage 3 and `ops-console` at
the end of Stage 3.

**Driver** — onboarding, profile, vehicle with accessibility features,
availability, admin approval workflow, assigned-ride list, accept/reject with
reason, the full state-transition sequence, delay and issue reporting, trip
history.

**Live tracking** — permission flow, foreground tracking while a ride is active,
server-side authorisation of every location write, Redis current position,
sampled history in Postgres with retention, WebSocket fan-out to family and ops,
periodic ETA, staleness indication, offline queue and reconnect, automatic
termination on completion or cancellation.

**Notifications** — in-app centre, push (FCM), email; SMS behind an interface.
The fifteen MVP events from the brief. Per-user, per-channel preferences.
**Notification bodies carry no appointment detail, clinic name, address or patient
name** — they say something changed and ask the recipient to open the app.

**Payments** — Stripe customer, saved payment method via SetupIntent, authorise at
assignment, capture at completion, failure handling and retry, refunds, receipts,
history, signed webhooks with idempotency, reconciliation job, internal ledger.

**Subscriptions** — configurable plans, trial, subscribe/upgrade/downgrade/cancel,
renewal failure handling, entitlement checks.

**Administration** — user/patient/driver/clinic/appointment/ride/payment/
subscription lists, driver approval, suspension, refunds, audit-log viewer,
feature flags, basic operational analytics.

**Cross-cutting** — RBAC + resource + organisation + patient-relationship
authorisation on every protected query; audit events for every sensitive action;
structured redacting logs; correlation IDs; health/readiness/liveness;
rate limiting; idempotency keys on money and state-changing commands.

## Post-MVP (designed for, not built)

Caregiver marketplace · clinic portal and integrations · AI coordination assistant
· automated dispatch optimisation · multi-stop and pooled routing · recurring
rides · insurance and Medicaid billing · EHR integration · clinic subscriptions ·
enterprise SSO/SCIM · multi-region · data warehouse · driver payouts and payroll ·
in-app voice/video.

## Explicit non-goals

CareBridge is **not** an EHR, not a diagnosis or triage system, not an emergency
service, not a 911 replacement, not clinical decision support, not a
medication-prescribing or medication-management system, and not a medical device.

We will not store diagnoses, medications, clinical notes or lab results in the
MVP. Appointment "type" is a coarse coordination label (e.g. *specialist visit*),
never a condition. No AI medical advice, at any stage. No automated background
checks presented as verification. No blockchain. No microservices until an actual
scaling, ownership or deployment need is demonstrated.

---

# Section 4 — Recommended architecture

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
                 │ (RDS)        │ │(ElastiCache)│ │ documents │
                 │ source of    │ │ live loc,  │ │ receipts  │
                 │ truth, audit │ │ queues,    │ └───────────┘
                 └──────────────┘ │ ws pub/sub │
                                  │ idempotency│
                                  └────────────┘
                         │               │
                         ▼               ▼
                  Stripe · SES · FCM · Maps/Routing vendor
```

## Why Flutter

One Dart codebase produces both apps for both platforms, and — critically — the
`ops-console` from the same models, client and design tokens. A three-surface
product built by a small team cannot afford three ecosystems. Flutter's rendering
model gives us pixel-consistent large touch targets and typography scaling, which
matters more here than usual because our end user may be 82 with a tremor. Mature
first-party plugins exist for the two hard requirements: Google Maps and
background/foreground location. Dart's null safety plus generated API clients
means the contract is type-checked end to end.

Accepted costs: Flutter Web bundle size and its weaker DOM accessibility (which is
why patient-facing surfaces stay native and only the internal console is web); and
platform-channel work for the Android foreground service.

**State management: Riverpod, not Bloc.** Compile-time-safe dependency injection,
first-class `StreamProvider`/`AsyncNotifier` primitives that model "live driver
position, may be stale, may be reconnecting" far more directly than Bloc's
event/state pairs, dramatically less boilerplate, and `ProviderContainer`
overrides make widget tests trivial. Bloc's advantage — a rigid, auditable event
log — matters less to us because the **server** owns the ride state machine and
already emits an audit trail. One choice, applied everywhere. (ADR-0002)

## Why not Next.js (and where web returns)

D2 removes the web portal. Family and patient value is realised on a phone —
push notifications and a map in the pocket — and a web portal would double the
client surface for the same journeys. Web returns for the internal ops console as
a Flutter Web target, and for the marketing site (a separate static concern, not
part of this application). If a family web portal is later justified, Next.js
against the same `/api/v1` contract is the intended path; nothing in this design
blocks it.

## Why NestJS

We need one place that owns authorisation, ride and appointment state machines,
driver assignment, payment state and the audit trail — because *no client may be
trusted with any of them*. NestJS gives modular boundaries with real DI, so
"transport" and "payments" can become separately owned and later separately
deployed without rewriting call sites. Guards and interceptors let authorisation,
correlation IDs, audit and idempotency be applied consistently by policy rather
than remembered per-handler — the single most common source of authz bugs.
Decorator-driven OpenAPI generation gives us the contract the Dart client is
generated from. First-class WebSocket gateway support means live tracking is not
a bolted-on second server.

## Why PostgreSQL

The data is a densely related transactional graph — user → patient → appointment →
ride → assignment → payment — and the invariants are exactly what relational
constraints exist to protect (a ride cannot outlive its appointment; an
assignment cannot reference an unapproved driver). Money and state transitions
need real transactions and `SELECT … FOR UPDATE`. Audit and consent records need
durable, queryable, append-only history. Partial and composite indexes serve the
dispatcher's "unassigned rides in the next 4 hours" query well past pilot scale.
PostGIS is available when automatic matching justifies it (T5).

**Prisma** as specified: type-safe client generated from a single schema file,
straightforward migration workflow, good transaction ergonomics. Its known
weaknesses — limited support for RLS and for complex geospatial or window queries
— are acceptable because (a) authorisation is enforced in the application layer by
design, and (b) `$queryRaw` with typed results covers the few analytical queries
we need. Recorded with its trade-offs in ADR-0007.

## Why Redis

Five distinct jobs, one dependency: **live location** (`ride:{id}:location`, short
TTL, overwritten every few seconds — writing this to Postgres at 500 rides ×
0.2 Hz would be a self-inflicted wound); **WebSocket pub/sub** so any API instance
can fan out to any subscriber; **BullMQ queues** for reminders, notifications,
ETA recalculation, reconciliation and retention jobs; **idempotency keys and
distributed locks** so a double-tapped "accept ride" or a replayed Stripe webhook
cannot double-process; and **rate limiting and short-lived ETA cache**.

Redis is treated as a cache, never as the source of truth. If Redis is lost the
system degrades — live maps go stale, jobs pause — but no ride, payment or audit
record is lost.

## Why Docker

Identical Postgres, Redis, mail and object-storage services on every developer
machine and in CI, so "works locally" is meaningful. Multi-stage production images
that ship only compiled output and production dependencies, running as a non-root
user with a `HEALTHCHECK`. Containers are also the deployment unit on ECS Fargate,
so the image tested in CI is the artefact deployed to production.

## Why AWS

Managed equivalents for every component we would otherwise operate (RDS,
ElastiCache, S3, ECS Fargate, ALB, Secrets Manager, CloudWatch, WAF), a signable
BAA covering the HIPAA-eligible services we use, and encryption at rest by default
via KMS. Fargate removes node management at our scale. The deliberate constraint:
**no AWS service enters the MVP without a stated need** — no EKS, no Step
Functions, no Kinesis. Vendor lock-in is limited by keeping business logic in the
container and vendor calls behind interfaces.

## Why a modular monolith

We have one team, one deployment and no independent scaling requirement, and the
core workflow — assign a driver, transition a ride, capture a payment, write an
audit event — spans four domains inside one transaction. Distributed across
services this becomes a saga with compensating actions, for zero present benefit.
The monolith is kept *extractable*: modules communicate through injected services
and typed events, never by reaching into each other's Prisma models; each module
owns its tables. When ride volume or team topology justifies it, `tracking` (the
highest-write, lowest-consistency module) extracts first. (ADR-0001)

## How WebSockets and GPS tracking work

**Permission and consent.** The driver app explains, in plain language, that
location is shared with the family only while a ride is active and stops
automatically at completion. Consent is recorded server-side with a timestamp and
version.

**Capture.** Tracking starts only on transition to `driver_en_route` and stops on
`completed`/`canceled`/`no_show`. Android uses a foreground service with a
persistent notification; iOS uses while-in-use background location (T2). Cadence
adapts: ~5 s while moving, ~30 s while stationary, paused entirely when the
device has not moved beyond the accuracy radius. This is a battery, data and cost
decision as much as an accuracy one.

**Transport.** Points go over the authenticated Socket.IO connection, batched when
several have queued. On network loss the app buffers a bounded ring (~100 points),
retries with jittered backoff, and drops the oldest rather than growing without
limit.

**Server authorisation — the security-critical step.** For every inbound point the
server verifies: the socket is authenticated; the sender is the driver *currently
assigned* to that ride; the ride is in a state where tracking is legal; and the
timestamp is sane. Anything else is rejected and audited. Subscription is guarded
symmetrically — joining `ride:{id}` requires an authorisation check that the
subscriber is a permitted family member, the assigned driver, or ops staff for
the owning organisation. A ride ID is not a capability.

**Storage.** Latest position → Redis, TTL ~2 minutes. A sampled subset (every
~30 s, plus every state transition) → `ride_location_samples` in Postgres for
dispute resolution and operational metrics, deleted by a retention job after 30
days. We do not keep every point forever.

**Distribution.** The gateway publishes to the Redis-backed room; subscribers
receive `{lat, lng, accuracy, heading, capturedAt, etaSeconds}`. Clients render
`capturedAt` age explicitly and switch to a "last seen HH:MM" state past the
staleness threshold. A server-side watchdog raises a dispatcher alert when an
active ride goes quiet.

**ETA.** Recomputed on a throttle (~60 s or on significant movement) via the
routing vendor, cached in Redis, and always presented as a range, never a
to-the-minute promise.

## How Stripe is integrated

Card data never touches our servers or our database. The Flutter apps use the
Stripe SDK's PaymentSheet; we store only Stripe customer and payment-method
identifiers.

Flow: a `Customer` is created on first payment setup → a `SetupIntent` saves a
card → on **driver assignment** a `PaymentIntent` is created with
`capture_method: manual`, authorising the estimated fare → on **ride completion**
the intent is captured for the final amount (a capture may be lower than the
authorisation; a materially higher final fare requires a new intent) → on
cancellation the authorisation is released, subject to the cancellation policy.

Every mutating call carries an idempotency key derived from our own entity IDs.
Webhooks are verified against the signing secret **before parsing**, recorded in a
`webhook_events` table keyed by Stripe event ID (the unique constraint is what
makes replay a no-op), and processed asynchronously from a queue. Our
`payments`/`ledger` tables are authoritative for internal state; a nightly
reconciliation job compares them to Stripe and alerts on drift. Subscriptions use
Stripe Billing with entitlements resolved server-side. Test mode throughout
development, with the same code path.

---

# Section 5 — Five-stage plan

## Stage 1 — Product foundation and architecture

**Objective:** every piece of scaffolding, documentation and infrastructure needed
to build features safely — and nothing else.

**Deliverables:** the eight product docs and nine architecture docs; ten ADRs;
monorepo (pnpm + melos); Docker Compose (Postgres, Redis, Mailpit, MinIO) with
healthchecks; NestJS app with validated config, redacting structured logging,
correlation IDs, global error handling, health/readiness/liveness, OpenAPI,
graceful shutdown, BullMQ wiring and audit service skeleton; Prisma with the
identity schema and first migration; Flutter workspace with shared `core`, `api`
and `ui` packages and both app shells (routing, Riverpod, Dio with auth
interceptor, secure storage, accessible theme, error handling); GitHub Actions CI.

**Dependencies:** Docker Desktop, Flutter SDK and Android SDK installed (task #1).

**Risks:** ~~toolchain absent on the dev machine~~ (resolved 2026-08-12);
Flutter Web ops console unvalidated; scaffolding sprawl.

**Testing:** health endpoint integration test; config validation unit tests; one
widget test and one router test per app; CI green from the first commit.

**Acceptance:** `docker compose up` brings up healthy Postgres and Redis; API
`/health` returns 200; migrations apply to a clean database; both Flutter apps
launch on an emulator; `make check` (format, lint, typecheck, test, build) passes;
every architecture doc and ADR exists; CI passes on a pull request.

## Stage 2 — Core care coordination

**Objective:** a family member can register, create a patient, invite a relative,
add a clinic, and manage appointments — with authorisation and audit enforced and
proven.

**Features:** full auth lifecycle including email verification, refresh rotation,
session revocation and consent records; patients, family links, invitations,
relationships and permissions; emergency contacts, addresses, mobility and
communication preferences; clinics with geocoding; appointments with the status
machine, history, reminders and calendar; notification centre, email and push,
with preferences.

**Technical deliverables:** authorisation policy service (role + organisation +
patient relationship + resource ownership) with one authoritative implementation;
audit service writing on every sensitive action; BullMQ reminder scheduling;
invitation tokens; family-app screens for all of the above; simplified patient
mode.

**Dependencies:** Stage 1; SES or SMTP credentials; a geocoding key.

**Risks:** authorisation logic duplicated across modules (mitigated by a single
policy service and negative-path tests); invitation flow as an account-takeover
vector (single-use, expiring, email-bound tokens); reminder scheduling across
timezones.

**Testing:** unit tests for permission resolution and appointment transitions;
integration tests per endpoint including the **negative** case — wrong family,
revoked access, wrong organisation; reminder job tests with a controlled clock;
widget and navigation tests; an end-to-end register → patient → clinic →
appointment journey.

**Acceptance:** all brief acceptance criteria, plus: an unauthorised user receives
an indistinguishable response for "not found" and "not permitted"; every mutation
writes an audit row; no personal data appears in any log line.

## Stage 3 — Transportation, dispatch and live tracking

**Objective:** the differentiator — a family requests a ride, a dispatcher assigns
it, a driver executes it, and the family watches it happen.

**Features:** driver onboarding, documents to S3 via pre-signed URLs, admin
approval, vehicles with accessibility attributes, availability; ride requests
(one-way, round trip, flexible return) with distance/duration/price estimates;
dispatch queue, manual assignment, reassignment with reason, delay and no-show
handling; the driver's full transition sequence; live tracking end to end; the
twelve ride notification events; `ops-console` (Flutter Web).

**Technical deliverables:** ride state machine as pure, exhaustively tested domain
code; Socket.IO gateway with authenticated handshake and per-room authorisation;
Redis location store and pub/sub; sampled persistence and the retention job;
adaptive-cadence location service in the driver app with offline queue; ETA
service with cache and circuit breaker; staleness watchdog and dispatcher alerts;
Android foreground service.

**Dependencies:** Stage 2; maps/routing contract; FCM project; physical devices
for real-world location testing.

**Landed so far (slice one — the domain, as planned):** the organisation and its
roster; the driver lifecycle state machine, with approval moving a billable
seat inside the same transaction; shifts; assignment eligibility as pure,
asserted rules (accessible vehicle, approved driver, one passenger at a time);
the dispatch queue ordered by when the car is needed; assignment and
reassignment-with-reason through the existing ride state machine, replacing the
scripted stand-in rather than adding to it.

**Landed since (slice two — the dispatcher's surface):** `apps/ops_console`, a
Flutter Web console over the dispatch API. It covers the queue ordered by when
the car is needed, assignment and reassignment-with-reason, the roster with the
shift/status split, the fleet, and the seat ledger behind the operator's
invoice. It is a **separate origin and a separate image** from the family app,
and it shares the generated client, the domain mirrors and the failure taxonomy
rather than reimplementing them — the last of those now lives in
`packages/dart/carebridge_client`, because the API's deliberate ambiguity
between "no such record" and "not yours" is precisely the thing a second
implementation would undo. This closes risk R1.

**Still outstanding in this stage:** driver documents to S3 and the upload
behind approval; the driver app and its adaptive-cadence location service; the
Socket.IO gateway and the Redis position store; the ETA service; the staleness
watchdog; and the Android foreground service. The console has no live map for
the same reason: there is no WebSocket surface yet for it to read.

**Risks (highest of any stage):** ~~Flutter Web ops console unvalidated~~
(R1, resolved — the console is built, tested and containerised); background-location platform restrictions and
store review (T2); battery drain damaging driver adoption; map/routing cost at
scale; WebSocket authorisation errors leaking a patient's live position — treated
as a **P0 security surface**; connectivity dead zones; ETA accuracy setting false
expectations.

**Testing:** exhaustive state-machine unit tests including every illegal
transition; WebSocket authorisation integration tests (unassigned driver rejected,
unrelated family rejected, subscription after completion rejected); Redis
integration tests; simulated network-loss and reconnect tests; a full end-to-end
ride; a documented manual field test on real devices.

**Acceptance:** all brief acceptance criteria, plus: location writes stop within
seconds of completion and are rejected thereafter; a stale position is visibly
marked in every client; a driver killing the app mid-ride does not corrupt ride
state.

## Stage 4 — Payments, subscriptions, operations, production readiness

**Objective:** commercially operable and safe to run a controlled pilot on.

**Features:** the full Stripe integration described in Section 4, for **both**
payers — a household and a transport operator ([ADR-0011](adr/0011-two-sided-subscription-billing.md));
recurring charges against the `SubscriptionPeriod` rows the billing model
already writes, dunning, and the seat-derived operator invoice; administration surfaces including
the audit-log viewer, driver approval, refunds and feature flags; the operations
analytics dashboard; production security hardening; Terraform for staging and
production; the pilot documentation set.

**Technical deliverables:** Terraform modules (network, RDS, ElastiCache, ECR,
ECS, ALB, S3, Secrets Manager, CloudWatch, Route 53, ACM, WAF); deployment
pipeline with migration step, staging auto-deploy, manual production approval and
post-deploy health check; documented rollback; backup and **tested** restore;
retention jobs; dependency, container and secret scanning in CI; alerting.

**Dependencies:** Stage 3; a Stripe account; an AWS account with a signed BAA; a
domain; legal review of terms and consent copy.

**Already landed ahead of this stage:** the plan catalogue, both billing
accounts, the subscription lifecycle, seat accounting and entitlement
enforcement.

**Landed since (slice one of this stage — the money movement):** a payments
port with a Stripe adapter and a local one that scripts its outcomes from the
card's last four digits, so a decline and the dunning that follows it are
reachable without an account; invoices, payment attempts and cards on file;
`BillingCycleService`, the hourly sweep that ends trials, renews periods,
completes cancellations and expires a closed grace window — which nothing did
before, with the consequence that every trial entitled the product permanently
and no period was ever billed; the dunning schedule, pinned to land its last
attempt inside the shortest grace window any plan offers; and the signed
webhook endpoint, whose event ids are claimed by a unique constraint so a
redelivery cannot credit an account twice.

**Still outstanding in this stage:** the administration surfaces — audit-log
viewer, driver approval, refund initiation, feature flags; the operations
analytics dashboard; Terraform and the deployment pipeline; the backup restore
rehearsal; and the pilot documentation set. Refunds are *reconciled* rather
than initiated: a refund issued in the processor's console lands against its
invoice through the webhook, and there is deliberately no endpoint to start one
without an approval surface behind it.

**Risks:** payment/ledger drift (reconciliation job plus alerting); webhook
replay and out-of-order delivery (idempotency table plus event-ID uniqueness);
refund and cancellation-policy disputes; Terraform state management; first
production migration.

**Testing:** payment success, failure, retry, partial capture and refund;
duplicate-webhook test asserting exactly one ledger entry; entitlement tests;
restore rehearsal from a real backup; load test of the tracking path; a security
test pass covering the OWASP API Top 10.

**Acceptance:** all brief acceptance criteria, plus: a restore from backup is
performed and timed, not merely documented; every sensitive administrative action
appears in the audit viewer; no HIPAA-compliance claim appears anywhere in code,
copy or docs.

## Stage 5 — Expansion (gated on pilot evidence)

Not begun until pilot metrics and feedback justify it. **5A** caregiver
marketplace (profiles, availability, booking, check-in/out, ratings, commission,
disputes — with no claim that platform checks replace background screening).
**5B** clinic portal (organisation accounts, expected arrivals, confirmation,
transport requests, return rides, integration APIs). **5C** AI coordination
assistant — logistics and communication only: natural-language ride creation
requiring human confirmation, daily family summaries, no-show risk alerts, support
triage. Hard rules: no diagnosis, no treatment advice, no emergency claims, human
confirmation for anything that books or charges, every AI-initiated action
audited with model version, minimum necessary data sent to any vendor, prompt-
injection defences on any connected content, and a signed vendor BAA first.
**5D** advanced transportation (assignment recommendations, route optimisation,
recurring rides, return prediction, accessibility-based matching — PostGIS lands
here). **5E** enterprise scale (read replicas, event-driven integrations, data
warehouse, org billing, SSO/SCIM, SLOs, multi-region). Microservice extraction
only when a real scaling, ownership or reliability need exists.

---

# Section 6 — Domain model

Conventions: UUID v7 primary keys (time-ordered, index-friendly, non-enumerable);
`created_at`/`updated_at` on every table; `timestamptz` in UTC everywhere with the
IANA zone stored beside any user-facing time; soft delete only where audit or
regulation demands it (patients, appointments, rides), hard delete elsewhere;
`version` columns for optimistic locking on rides and appointments; every table
carries a sensitivity classification driving log redaction and retention.

### Identity & tenancy

- **User** — email (citext, unique), password hash (argon2id), name, phone,
  status, verification and MFA state, locale, timezone. *Sensitive.*
- **UserSession** — refresh-token family, device and user-agent fingerprint, IP,
  issued/expires/revoked timestamps. Rotation detection: reuse of a rotated token
  revokes the entire family.
- **UserConsent** — user, consent type (terms, privacy, location sharing,
  notifications), document version, timestamp, IP. Append-only.
- **Organization** — name, type (`transport_provider` | `clinic` | `care_agency` |
  `platform`), status, settings.
- **OrganizationMembership** — user × organisation × role. **A user may belong to
  several organisations**; this is what keeps a later multi-tenant model from
  being a rewrite (Section 11 of the brief).
- **Role / Permission / RolePermission** — named roles mapping to fine-grained
  permissions. Roles are data, not enum constants scattered through code.

### Patient & family

- **Patient** — preferred name (required), legal name (optional, collected only
  when a provider requires a records match), phone, email, language, timezone,
  optional `age_band` enum, status. **No full date of birth** — it is the
  strongest re-identification key we could hold and nothing in the MVP workflow
  needs it. *Highly sensitive.*
- **PatientAccess** — user × patient, relationship type, permission set
  (view / schedule / request transport / pay / manage access), granted-by,
  granted-at, revoked-at. **The central authorisation edge**; every patient-scoped
  query resolves through it.
- **PatientInvitation** — single-use, email-bound, expiring token; status.
- **EmergencyContact** — name, relationship, phone, priority.
- **PatientAddress** — label, structured address, geocoded lat/lng, access notes
  ("gate code", "flat is up one flight"), default flag.
- **MobilityRequirement** — wheelchair type, transfer assistance, walker, oxygen,
  visual/hearing needs, escort-to-door, free-text notes. *Operationally necessary,
  deliberately non-clinical.*

### Clinics

- **Clinic** — name, phone, organisation link (nullable in the MVP), status.
- **ClinicLocation** — address, geocoded coordinates, operating notes, entrance
  and drop-off instructions.

### Appointments

- **Appointment** — patient, clinic location, scheduled start, expected duration,
  coarse type, coordination notes, transport-required flag, status, timezone,
  `version`.
- **AppointmentStatusHistory** — append-only: from, to, actor, reason, timestamp.
- **AppointmentReminder** — offset, channel, scheduled-for, sent-at, job ID.

### Transportation

- **TransportationProvider** — organisation, service area, capabilities.
- **Driver** — user, provider, approval status, licence reference (not the number),
  document completeness, rating, active flag.
- **DriverDocument** — type, S3 key, expiry, review status, reviewer. Never public.
- **Vehicle** — provider, make/model/year, plate, capacity, wheelchair-accessible
  flag, ramp/lift type, inspection expiry.
- **DriverAvailability** — recurring windows plus one-off exceptions.
- **Ride** — patient, optional appointment, requester, direction
  (`outbound` | `return`), pickup and destination (address + coordinates snapshot),
  scheduled pickup, flexible-return flag, assistance requirements, wheelchair
  requirement, estimates, final distance/duration/price, status, cancellation
  reason, `version`. A round trip is **two rides linked by `round_trip_group_id`**
  — not one ride with two legs — because each leg is independently assigned,
  tracked, cancelled and priced.
- **RideAssignment** — ride, driver, vehicle, assigned-by, assigned-at,
  accepted/rejected-at, rejection reason, superseded-at. History is preserved;
  reassignment appends.
- **RideStatusHistory** — append-only, actor-attributed, with reason.
- **RideEvent** — richer operational timeline (delay reported, issue raised, call
  placed) feeding the family timeline and dispute resolution.
- **RideLocationSample** — sampled coordinates, accuracy, heading, speed,
  captured-at, received-at. **30-day retention, enforced by job.** Live position
  lives in Redis, not here.
- **PriceEstimate** — pricing-rule version, distance, duration, base, surcharges,
  total, currency. Kept so a historical charge can always be explained.

### Money

- **PricingRule** — configurable base fare, per-mile, per-minute, wait, minimum,
  accessibility surcharge; effective date range. Prices are **never** constants in
  code.
- **Payment** — ride or invoice, Stripe payment-intent ID, amount authorised,
  amount captured, currency, status, failure reason, idempotency key.
- **Refund** — payment, amount, reason, initiated-by, Stripe refund ID, status.
- **LedgerEntry** — append-only internal double-entry record; the authoritative
  internal view reconciled nightly against Stripe.
- **Organization** — the transport operator. Kind, name, slug, contact address,
  timezone. Exists because a dispatch company that pays for seats cannot be an
  implicit thing outside the system.
- **OrganizationMembership** — user, organisation, `OrgRole`, revoked-at.
  Many-to-many, which is what keeps a later multi-tenant model from being a
  rewrite.
- **BillingAccount** — payer (`family` | `dispatchOrganization`), owning user
  **or** organisation (exactly one, by CHECK constraint), billing email, Stripe
  customer ID.
- **SubscriptionPlan** — code, **version**, payer, interval, name, base price,
  included seats, entitlements, trial days, grace days, active flag. Annual is
  a separate row, not a multiplier.
- **SubscriptionPlanSeatTier** — the graduated per-driver ladder. `upToSeats` is
  a total driver count; the final tier is unbounded.
- **Subscription** — billing account, plan, Stripe subscription ID, status,
  interval, seats, trial and period bounds, past-due-since, cancel-requested-at,
  carried credit. At most one live per account, by partial unique index.
- **SubscriptionPeriod** — append-only. Copies plan code, version, interval,
  seats billed and the itemisation, so a superseded plan cannot rewrite history.
- **SeatLedgerEntry** — append-only record of a driver taking or releasing a
  billable seat, with the proration charged. The audit trail behind an invoice
  line.
- **Invoice** — Stripe invoice mirror plus receipt S3 key.
- **WebhookEvent** — provider, provider event ID (**unique** — the constraint is
  the idempotency guarantee), payload hash, received/processed timestamps, status.

### Communication & platform

- **Notification** — recipient, type, channel, entity reference, read-at,
  delivery status. **Body carries no appointment, clinic, address or patient
  detail.**
- **NotificationPreference** — user × event type × channel.
- **DeviceToken** — user, FCM token, platform, app target, last-seen, revoked-at.
- **SupportTicket / SupportMessage** — subject, category, status, priority,
  assignee, thread.
- **InternalNote** — polymorphic staff-only note with author and timestamp.
- **AuditLog** — actor, actor role, action, entity type and ID, organisation,
  correlation ID, IP, user agent, before/after **field names only for sensitive
  fields — never values**, timestamp. Append-only, no update or delete path.
- **FeatureFlag** — key, description, enabled, targeting rules.

### The relationships that matter most

```
User ──< OrganizationMembership >── Organization
User ──< PatientAccess >────────── Patient          ← every patient-scoped
                                     │                authorisation check
                                     ├──< EmergencyContact
                                     ├──< PatientAddress
                                     ├──< MobilityRequirement
                                     └──< Appointment ──> ClinicLocation ──> Clinic
                                              │
                                              └──< Ride ──< RideAssignment ──> Driver ──> Vehicle
                                                     ├──< RideStatusHistory
                                                     ├──< RideLocationSample  (30-day retention)
                                                     └──< Payment ──< Refund
```

Authorisation for a ride is never asked directly; it resolves *up* the graph —
ride → appointment/patient → `PatientAccess`, or ride → assignment → driver, or
ride → provider → `OrganizationMembership`. One traversal, one implementation.

---

# Section 7 — API plan

Versioned under `/api/v1`. Every endpoint declares: method, route, required
permission, request and response schema (Zod/DTO), validation rules, error
responses, idempotency requirement, rate-limit class and audit behaviour. OpenAPI
is generated from decorators; the Dart client is generated from the OpenAPI spec.

| Module | Endpoint categories |
| ------ | ------------------- |
| **auth** | register · verify-email · resend-verification · login · refresh · logout · logout-all · password reset request/confirm · sessions list/revoke · MFA enrol/verify (scaffold) · consents |
| **me** | profile read/update · notification preferences · device tokens · consents · account deactivation · data export request |
| **patients** | CRUD · archive · timeline · access list · invite · accept invitation · update permissions · revoke access · access history |
| **patient sub-resources** | emergency contacts · addresses · mobility requirements (nested CRUD) |
| **clinics** | CRUD · search · archive · locations CRUD · geocode-and-validate |
| **appointments** | CRUD · reschedule · cancel · status history · list (filters, calendar range) · reminders |
| **rides** | create (from appointment or standalone) · estimate · read · list · cancel · reschedule · timeline · status history · current location |
| **dispatch** | unassigned queue · assign · reassign · driver availability · active rides · delayed rides · internal notes · alerts · force status override (audited) |
| **drivers** | onboarding · profile · documents (pre-signed upload) · vehicles CRUD · availability · assigned rides · accept · reject · **transition** (single endpoint, server-validated) · report delay · report issue · history |
| **tracking** (WS + REST) | `POST /rides/:id/location` (batched fallback) · WS `ride:subscribe`, `ride:location`, `ride:status`, `ride:eta` · `GET /rides/:id/location` (last known + age) |
| **payments** | setup-intent · payment methods list/delete · ride payment status · retry · receipts · refund (admin) · history |
| **subscriptions** | plans · subscribe · change plan · cancel · status · entitlements · billing portal session |
| **notifications** | list · unread count · mark read · preferences |
| **support** | create ticket · list · messages · attachments |
| **admin** | users · patients · drivers (approve/reject) · clinics · appointments · rides · payments · refunds · subscriptions · audit log · feature flags · configuration · notification templates |
| **reports** | operational metrics · ride funnel · assignment latency · pickup delay · no-show and cancellation rates · payment success · subscription counts |
| **system** | `/health` · `/health/ready` · `/health/live` · `/docs` (OpenAPI, non-production) |

**Cross-cutting rules.** Idempotency keys required on ride creation, assignment,
driver transitions, and every payment mutation. Rate-limit classes: `auth-strict`
(login, reset, verification), `write-standard`, `read-standard`,
`tracking-high-volume`. Errors follow one envelope —
`{ error: { code, message, correlationId, details? } }` — and
`AuthorizationError` and `NotFoundError` return an **identical** user-visible
response so record existence cannot be probed. Every mutating endpoint writes an
audit event; sensitive reads (patient profile, audit log, driver documents) are
audited too.

---

# Section 8 — Repository structure

Repository root is the project root (`d:\Projects\driver`).

```text
carebridge/
├── apps/
│   ├── api/                          # NestJS modular monolith
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/               # cross-cutting, no domain logic
│   │   │   │   ├── config/           # zod-validated env
│   │   │   │   ├── logging/          # pino + redaction
│   │   │   │   ├── correlation/
│   │   │   │   ├── errors/           # filters, error envelope
│   │   │   │   ├── validation/
│   │   │   │   ├── idempotency/
│   │   │   │   ├── pagination/
│   │   │   │   └── decorators/
│   │   │   ├── infrastructure/
│   │   │   │   ├── prisma/
│   │   │   │   ├── redis/
│   │   │   │   ├── queue/            # BullMQ
│   │   │   │   ├── storage/          # S3 abstraction
│   │   │   │   ├── mail/
│   │   │   │   ├── push/             # FCM
│   │   │   │   ├── sms/              # interface + dev adapter
│   │   │   │   ├── maps/             # geocoding + routing behind interface
│   │   │   │   └── payments/         # Stripe client
│   │   │   └── modules/
│   │   │       ├── auth/             # each module:
│   │   │       ├── users/            #   domain/    pure rules, no I/O
│   │   │       ├── organizations/    #   dto/       request/response contracts
│   │   │       ├── authz/            #   data/      Prisma repositories
│   │   │       ├── audit/            #   *.service.ts
│   │   │       ├── patients/         #   *.controller.ts  (thin)
│   │   │       ├── clinics/          #   *.module.ts
│   │   │       ├── appointments/
│   │   │       ├── drivers/
│   │   │       ├── vehicles/
│   │   │       ├── rides/
│   │   │       ├── dispatch/
│   │   │       ├── tracking/         # gateway + redis store + retention
│   │   │       ├── payments/
│   │   │       ├── subscriptions/
│   │   │       ├── notifications/
│   │   │       ├── support/
│   │   │       ├── admin/
│   │   │       ├── reports/
│   │   │       └── health/
│   │   ├── test/                     # integration + e2e
│   │   ├── Dockerfile
│   │   ├── Dockerfile.dev
│   │   └── package.json
│   │
│   ├── mobile_family/                # Flutter — family + patient
│   │   ├── lib/
│   │   │   ├── main.dart
│   │   │   ├── app/                  # router, theme, bootstrap
│   │   │   └── features/
│   │   │       ├── auth/             # each feature:
│   │   │       ├── onboarding/       #   data/         repositories
│   │   │       ├── dashboard/        #   application/  Riverpod notifiers
│   │   │       ├── patients/         #   presentation/ screens + widgets
│   │   │       ├── appointments/
│   │   │       ├── rides/
│   │   │       ├── tracking/
│   │   │       ├── notifications/
│   │   │       ├── payments/
│   │   │       ├── subscription/
│   │   │       ├── support/
│   │   │       └── settings/         # includes simplified patient mode
│   │   ├── test/
│   │   ├── integration_test/
│   │   ├── android/  ios/
│   │   └── pubspec.yaml
│   │
│   ├── mobile_driver/                # Flutter — driver
│   │   ├── lib/
│   │   │   ├── main.dart
│   │   │   ├── app/
│   │   │   └── features/
│   │   │       ├── auth/
│   │   │       ├── onboarding/       # documents, vehicle
│   │   │       ├── schedule/
│   │   │       ├── ride_detail/
│   │   │       ├── active_ride/      # the core screen
│   │   │       ├── location/         # permissions, foreground service, queue
│   │   │       ├── issues/
│   │   │       ├── history/
│   │   │       └── profile/
│   │   ├── android/  ios/
│   │   └── pubspec.yaml
│   │
│   └── ops_console/                  # Flutter Web — dispatch console (built)
│       ├── lib/
│       └── pubspec.yaml
│
├── packages/
│   ├── dart/
│   │   ├── carebridge_core/          # env, storage, errors, result, logging
│   │   ├── carebridge_api/           # GENERATED from OpenAPI — never hand-edited
│   │   ├── carebridge_domain/        # shared enums + status machines (mirror)
│   │   └── carebridge_ui/            # design tokens, accessible components
│   ├── contracts/                    # openapi.json + generated TS types
│   ├── eslint-config/
│   ├── typescript-config/
│   └── testing/                      # shared TS test utils, factories
│
├── infrastructure/
│   ├── docker/                       # compose overrides, init scripts
│   ├── terraform/
│   │   ├── modules/                  # network, rds, redis, ecr, ecs, alb,
│   │   │                             # s3, secrets, monitoring, dns, waf
│   │   └── environments/{staging,production}/
│   └── scripts/                      # bootstrap, migrate, seed, restore-drill
│
├── docs/
│   ├── FOUNDATION.md                 # this document
│   ├── product/                      # vision, problem, personas, journeys,
│   │                                 # mvp-scope, non-goals, business-model,
│   │                                 # success-metrics
│   ├── architecture/                 # system-overview, container-diagram,
│   │                                 # domain-model, data-flow, security-model,
│   │                                 # multi-tenancy, realtime-tracking,
│   │                                 # deployment, disaster-recovery
│   ├── adr/                          # 0001…0010
│   ├── api/
│   ├── runbooks/
│   └── privacy/                      # data map, retention schedule, DPIA notes
│
├── .github/workflows/                # ci.yml, deploy-staging.yml,
│                                     # deploy-production.yml, security-scan.yml
├── docker-compose.yml
├── melos.yaml
├── pnpm-workspace.yaml
├── Makefile
├── .env.example
├── CLAUDE.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── README.md
```

---

# Section 9 — Security and privacy plan

## Authentication

Application-managed in NestJS rather than Cognito or Auth0 (ADR-0003). The
deciding factors: our authorisation model is dominated by the
`PatientAccess` relationship, which no managed provider models natively — we
would end up maintaining that logic ourselves regardless, plus a synchronisation
problem; local development stays fully self-contained; and there is no
per-MAU cost curve on a product whose users are mostly free-tier family members.
The accepted cost is that we own password storage, reset flows, MFA and lockout —
implemented once, tested hard, and re-evaluated at enterprise SSO (Stage 5E),
which is the point where a managed provider genuinely pays for itself.

Argon2id password hashing with tuned parameters. Access tokens are short-lived
(≈10 min) JWTs carrying only user ID, roles and token version — **never** patient
identifiers or organisation lists, which are resolved server-side per request so
revocation is immediate. Refresh tokens are opaque, stored hashed, rotated on
every use, and grouped in families: presenting a rotated token revokes the whole
family and raises a security event. Tokens live in `flutter_secure_storage`
(Keychain / EncryptedSharedPreferences), never in shared preferences. Failed
logins are rate-limited and trigger progressive lockout. TOTP MFA scaffolding is
present from Stage 2 and enforced for staff and admin roles.

## Authorisation

One policy service. Every protected operation answers six questions in order:
**who** (authenticated identity), **what role**, **which organisation**, **what
relationship to this patient**, **who owns this resource**, **is this operation
permitted**. Enforced by a guard plus an explicit policy call in the service
layer — never by hiding a button, never re-implemented per module. Negative tests
(wrong family, revoked access, wrong organisation, unapproved driver, non-admin)
are a merge requirement, not a nice-to-have.

WebSocket authorisation is treated as a first-class surface, not an afterthought:
the handshake is authenticated, every room join is policy-checked, and every
inbound location point re-verifies assignment and ride state. A ride ID is never
a capability.

## Data minimisation

The controlling rule: **a field must justify itself against a task in a documented
journey before it enters the schema.** Specifics carried forward from the earlier
build because the reasoning still holds:

- **No full date of birth.** Name + address + DOB is the classic
  re-identification triple and the standard identity-verification set. Nothing in
  the MVP needs it; if a provider later requires it for a records match, it is
  collected per-request at the point of need, not stored on the profile. An
  optional coarse `age_band` covers any genuine mobility-planning need.
- **Legal name optional, preferred name required.** Someone must be greeted by the
  name they use; only an operational records-match justifies a legal name.
- **No clinical data.** Appointment type is a coarse coordination label.
  Mobility requirements are operational, not diagnostic.
- **Contentless notifications.** A phone on a kitchen table is readable by whoever
  is in the room — and for an older adult that may include the person they most
  need privacy from. Notifications say something changed and ask the recipient to
  open the app. A compromised inbox yields nothing.
- **Location is sampled and expires**, not accumulated indefinitely.

## Audit

Append-only `AuditLog` with no update or delete path, written for every mutation,
every administrative action, every authorisation failure, every consent change,
and sensitive reads (patient profile, driver documents, audit viewer). Records
actor, role, action, entity, organisation, correlation ID, IP and user agent.
Changed **field names** are recorded; changed **values** are not. Audit writes
participate in the same transaction as the change they describe, so an audited
action cannot succeed unaudited.

## Encryption

TLS 1.2+ everywhere in production, HSTS, no plaintext listener. At rest: RDS,
ElastiCache, S3 and EBS encrypted with KMS. S3 objects (driver documents,
receipts) are private with no public ACL path and are reachable only through
short-lived pre-signed URLs after an authorisation check. Secrets live in AWS
Secrets Manager, injected as task-definition secrets — never in an image, a repo,
or a client bundle. Client-side config is public by construction; anything secret
is server-only, enforced by lint.

## Logging

Structured JSON via pino with a **redaction denylist applied at the logger**, not
at call sites: names, emails, phones, addresses, coordinates, DOB fields, tokens,
authorisation headers, card data. `console` is banned by lint. Users see a generic
message plus a correlation ID; the detail stays server-side. Third-party error
reporting goes through a single seam so its redaction surface is auditable in one
place.

## Retention

Per-entity retention is declared in `docs/privacy/` and enforced by scheduled
jobs, not by intention: location samples 30 days; notification records 90 days;
audit logs 7 years (append-only); soft-deleted patients purged after a defined
grace period; support attachments per policy; backups per RPO/RTO. Account
deletion produces an export, then anonymises what audit and financial regulation
requires us to keep and deletes the rest.

## Application hardening

Zod/DTO validation at every boundary. Parameterised queries only (Prisma; raw SQL
only with typed parameters). Secure headers via Helmet. CORS allowlist per
environment. Rate limiting per class, keyed by user and IP. Uploads restricted by
type and size, given server-generated keys, and passed through a malware-scan
integration point before becoming downloadable. Webhook signatures verified
before parsing. Idempotency enforced on money and state-changing commands.
Dependency, container and secret scanning in CI, blocking on high severity.

## Vendor risk

| Vendor | Data | Control |
| ------ | ---- | ------- |
| AWS | Everything | BAA required before pilot; HIPAA-eligible services only |
| Stripe | Name, email, amount — **no health or ride detail** | PCI SAQ-A via SDK; deliberately excluded from PHI scope |
| Google/Mapbox | Coordinates, addresses | Reviewed for retention; addresses sent without patient identity where possible |
| FCM | Device tokens, contentless payloads | Contentless notification policy limits exposure |
| SES / SMTP | Email addresses, contentless bodies | BAA; contentless policy |
| SMS vendor | Phone numbers, contentless bodies | BAA; contentless policy |
| Sentry (later) | Stack traces | Redaction before send; no PII in error context |

A vendor inventory with data classification and agreement status is maintained in
`docs/privacy/` and reviewed each stage.

## Compliance posture

We describe the system as **"HIPAA-ready architecture"** and never as "HIPAA
compliant". Compliance requires legal determination of our role (L1), executed
BAAs, documented administrative and physical safeguards, workforce training,
access reviews and an incident-response process — none of which are properties of
source code. The architecture supports all of them; the claim waits for the rest.

---

# Section 10 — Implementation sequence: the first twenty tasks

Ordered. Each ends in a working, committed state.

| # | Task | Output |
| - | ---- | ------ |
| **1** | ~~**Install prerequisites**~~ — **Done, 2026-08-12.** Docker 29.7.2 and Flutter 3.44.0 / Dart 3.12.0 installed and verified end to end. Android SDK and the Linux desktop toolchain remain outstanding; they are needed for the driver app in Stage 3, not before. | ✅ `docker compose up` healthy; `flutter analyze` clean |
| **2** | Initialise the monorepo — pnpm workspace, melos config, root scripts, Makefile, `.gitignore`, `.editorconfig`, Node/pnpm version pins, licence. | Repo skeleton, first commit |
| **3** | Shared tooling packages — `typescript-config` (strict, `noUncheckedIndexedAccess`), `eslint-config` including module-boundary rules and a ban on direct `process.env`, Prettier, Dart analysis options. | `packages/{typescript-config,eslint-config}` |
| **4** | Write the documentation set — the 8 product docs, 9 architecture docs, and ADRs 0001–0010 (monolith, Riverpod, auth strategy, map provider, background location, Stripe, Postgres+Prisma, Redis+BullMQ, AWS/ECS, multi-tenancy). Plus `CLAUDE.md`, `README`, `CONTRIBUTING`, `SECURITY`. | `docs/` populated |
| **5** | Docker Compose — Postgres 16, Redis 7, Mailpit, MinIO; healthchecks; named volumes; `.env.example` and env-validation script. | `docker compose up` healthy |
| **6** | NestJS bootstrap — zod-validated config, pino logging with the redaction denylist, correlation-ID middleware, global exception filter and error envelope, global ValidationPipe, Terminus health/ready/live, OpenAPI, graceful shutdown, Dockerfile (multi-stage, non-root, healthcheck). | `GET /health` → 200 |
| **7** | Prisma + first migration — identity and tenancy schema (User, UserSession, UserConsent, Organization, OrganizationMembership, Role, Permission, AuditLog); seed script with obviously fictional data. | Migration applies clean |
| **8** | Auth module — register, verify email, login, refresh with rotation and family revocation, logout, logout-all, password reset, argon2id, rate limiting, lockout, session list, consent recording. | Auth endpoints + tests |
| **9** | Authorisation and audit foundation — `AuthContext`, guards, the single policy service (role + org + patient relationship + ownership), permission decorators, transactional audit service. | Reusable authz + audit |
| **10** | Testing foundation — Jest unit config, integration harness against containerised Postgres and Redis, factories, auth helpers, and the **negative-path** helper set. CI-parallel-safe. | `pnpm test` green |
| **11** | CI pipeline — install, format check, lint, typecheck, unit + integration tests, Prisma migration validation, build, Docker build, dependency and secret scanning. | Green on PR |
| **12** | Flutter workspace — melos-managed; `carebridge_core`, `carebridge_ui` (tokens: 44px minimum targets, 17px base, AA contrast, dynamic type), `carebridge_domain`; both app shells. | `flutter run` on both |
| **13** | Flutter foundation — Riverpod, GoRouter with auth-aware redirects, Dio with correlation-ID/auth/refresh/retry interceptors, secure token storage, error handling and offline cache; OpenAPI → `carebridge_api` generation wired into the build. | Shared client layer |
| **14** | Auth flows in both apps against the real API — register, verify, login, refresh, logout, logout-all, session list; plus the simplified-patient-mode toggle in the family app. | End-to-end login works |
| **15** | Patients module (API) — patient CRUD, `PatientAccess`, invitations, permissions, emergency contacts, addresses, mobility requirements; full authz and audit; negative tests. | Patient API + tests |
| **16** | Clinics module — CRUD, locations, search, geocoding behind the maps interface with a deterministic dev adapter. | Clinic API + tests |
| **17** | Appointments module — CRUD, reschedule, cancel, the status machine as pure exhaustively-tested domain code, status history, BullMQ reminder scheduling with timezone correctness. | Appointment API + tests |
| **18** | Notifications module — in-app centre, email via Mailpit locally, FCM push, device tokens, per-channel preferences, contentless templates. | Notifications working |
| **19** | Family app core screens — dashboard, patient list and profile, family access management, appointment list/detail/create/reschedule, notification centre; with real loading, empty and error states, and accessibility verified. | Journeys 1–2 usable |
| **20** | **Stage 1–2 checkpoint** — run the full validation suite, update every affected doc, write the unresolved-risk list, verify acceptance criteria one by one, tag `v0.2.0-stage2`. | Reviewable checkpoint |

Stage 3 begins at task 21 with the driver and ride domain — the state machine
first, tracking second, `ops-console` last.

---

## Open risks

| ID | Risk | Mitigation |
| -- | ---- | ---------- |
| **R1** | Dispatcher has no adequate surface until the Flutter Web console lands. | **Closed.** The REST surface — roster, shifts, queue, assign, reassign — landed in Stage 3 slice one; `apps/ops_console` landed in slice two with the queue, assignment, roster, fleet and seat ledger, on its own origin and image. Auto-assignment remains deferred by choice: the eligibility filter it would rank is in place, and manual assignment from a server-ordered queue is the MVP. Still wants a dispatcher's sign-off against real traffic. |
| **R2** | Background location on iOS/Android may fail store review or drain battery. | Foreground-service-first (T2); real-device field test is a Stage 3 acceptance item. |
| **R3** | Flutter Web accessibility is weaker than DOM. | Internal tool only; patient-facing surfaces stay native. |
| **R4** | Map/routing spend scales with tracked rides. | Vendor behind an interface; ETA throttled and cached; cost alarm from Stage 3. |
| **R5** | No web portal may block a family segment that will not install an app. | Measure in pilot; Next.js portal against the same API is the unblocked path. |
| **R6** | Legal role determination (L1) is unresolved. | Architecture assumes strictest case; counsel engaged before Stage 4 pilot. |
| **R7** | Card-only payment (B3) narrows the addressable market. | Accepted for pilot; insurance/Medicaid is a Stage 5 decision. |
| **R9** | The operator may refuse per-driver pricing, or price-shop against a per-ride model. | The ladder is `SeatTier` rows: moving to per-vehicle or per-dispatcher is a seed change, not a rewrite. Measured in the pilot. |
| **R10** | A household's plan lapsing mid-trip would be the worst possible moment to enforce an entitlement. | Grace window on the plan row; `pendingCancellation` runs to period end; both pinned by test. |
| **R8** | ~~Docker and Flutter absent locally.~~ | **Closed, 2026-08-12.** Docker 29.7.2 (user added to the `docker` group) and Flutter 3.44.0 / Dart 3.12.0 are installed and verified. `docker compose up` brings up six healthy containers; the API image builds and runs; `flutter analyze` and `flutter test` are clean. Android SDK and the Linux desktop toolchain are still absent — neither is needed until the driver app (Stage 3). |
