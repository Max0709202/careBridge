# CareBridge — family app + API

Coordinate an older relative's medical appointments and the transportation to
them, and know they arrived safely.

This repository holds the **family/patient Flutter app**, the **NestJS API** it
runs against, and the generated Dart client between them. The plan it is being
built to — product, architecture, five stages, domain model, security — is in
[docs/FOUNDATION.md](docs/FOUNDATION.md), expanded across
[docs/](docs/README.md): eight product documents, nine architecture documents
and eleven ADRs.

---

## Run it

```bash
cp .env.example .env
# Replace JWT_SECRET with a real one — the API refuses to start without it:
#   openssl rand -base64 48

docker compose up --build
```

Then open **<http://localhost:8080>** and sign in with the pre-filled
credentials (`sarah@example.com` / `demo-password`).

There are three ways in, all on the same password — a family member, a
dispatcher, and a driver:

| surface | account |
| --- | --- |
| family app, `:8080` | `sarah@example.com` |
| ops console, `:8081` | `dispatch@meridiantransit.example` |
| driver app, on a device | `marcus@meridiantransit.example` |
| admin API, `/api/v1/admin` | `admin@carebridge.example` — seeded with a confirmed second factor, because the guard refuses platform staff without one |

Seven containers come up: PostgreSQL 16, Redis 7, Mailpit, MinIO, the API, and
the two Flutter web surfaces behind nginx — the family app and the dispatch
console, on separate origins. Migrations apply on start and the demo family is
seeded (idempotently — set `SEED_ON_START=false` for an empty database).
Everything you do is written to Postgres and survives `docker compose restart`.

| | |
| --- | --- |
| App | <http://localhost:8080> |
| **Ops console** | <http://localhost:8081> — the dispatch surface, same credentials |
| API | <http://localhost:8080/api/v1> (proxied), or `:3000` directly |
| API docs | <http://localhost:3000/api/v1/docs> — absent in production |
| Health | <http://localhost:8080/api/v1/health> |
| **Mailpit** | <http://localhost:8025> — every email the API sends, including the verification, reset and invitation links |
| MinIO | <http://localhost:9001> |
| Postgres | `localhost:55432` (loopback only) |
| Redis | `localhost:56379` (loopback only) |

nginx proxies `/api` to the API container, so every request the browser makes is
same-origin: no CORS, and no API hostname compiled into the JavaScript bundle.

### Working on the app without rebuilding the image

```bash
docker compose up -d db api          # backend only

flutter pub get
flutter run -d chrome \
  --dart-define=CAREBRIDGE_API_BASE_URL=http://localhost:3000/api/v1
```

The `--dart-define` is required off the web container, because the default base
URL is the relative `/api/v1` that the nginx proxy serves.

The dispatch console runs the same way, and `make ops` is the shorthand:

```bash
make ops                     # apps/ops_console, in Chrome, against :3000
```

The driver app is the one surface that is **not** web, and the reason is the
whole point of it: it keeps reporting position with the screen off, and no
browser will do that. It needs a device or an emulator:

```bash
make driver                  # apps/driver_app, against the host's :3000
```

### Checks

```bash
make check
```

Format, lint, typecheck, unit tests and the API-contract drift check — exactly
what CI runs, in CI's order. If the two ever diverge, CI is what is wrong.
Nothing in it is allowed to fail silently: the unit run enforces coverage
floors on both sides, and the pure rules in `domain/` are held at 100%.

```bash
make test-integration        # 178 tests, real app against real Postgres
```

Individually:

```bash
pnpm --filter @carebridge/api test          # 331 unit tests, with coverage floors
pnpm --filter @carebridge/api exec eslint . # boundaries, no-console, no process.env
flutter analyze && flutter test             # the app
dart run melos run test                     # the console and shared packages
```

Needs **pnpm 9** and **Node 22** for the API, and the **Flutter stable SDK
3.44.x** (Dart 3.12) for the app. Neither is needed to run the stack — Docker
builds both.

The integration suite runs against either scheduler, and that is the point
rather than a convenience — running it both ways is what proves the two queue
adapters are interchangeable:

```bash
make test-integration                                    # in-process scheduler
REDIS_URL=redis://127.0.0.1:56379 make test-integration  # the real BullMQ path
```

---

## Try the whole journey

1. Sign in → the dashboard shows Eleanor's cardiology follow-up in two days,
   with a round trip booked and awaiting a driver.
2. Tap the ride → **Follow the trip** → **Assign a driver and run the trip**.
3. Watch it run: driver assigned → on the way → arrived → picked up → in
   progress → arrived at the clinic → completed. The position updates, the ETA
   counts down, the freshness label ages, notifications accumulate, and the
   appointment status follows the ride.
4. Hit **Report a delay** mid-trip. Pause the trip and watch the location go
   stale, then lost — the marker hollows out and the banner turns red.
5. **Reload the page.** The trip is still running: it is executing on the
   server, not in the tab.

---

## What is real and what is standing in

| Real | Standing in |
| ---- | ----------- |
| Every Stage-2 feature is reachable **from the app**: care-circle invitations, the session list, two-factor enrolment, notification preferences, the verification prompt | |
| PostgreSQL is the source of truth. Nothing resets on restart. | The **driver app** — "Preview controls" ask the server to run the same transitions |
| **Dispatch**: the driver lifecycle (invite → approve → suspend → offboard), shifts, a queue ordered by when the car is needed, and assignment with reassignment reasons | The **dispatch console** — the API is real, the Flutter Web surface for it is not |
| Full auth lifecycle: argon2id, rotating refresh tokens with family revocation, email verification, password reset, session list and revoke, sign-out-everywhere | The **dispatch service** — assignment is scripted, not matched |
| TOTP MFA end to end — enrol, confirm, sign in with a code, spend a recovery code — verified against the RFC 6238 vectors, secret encrypted at rest | Real GPS, maps and routing — the route view is a schematic, deliberately, and positions come from the preview runner |
| Assignment eligibility asserted server-side: a wheelchair trip cannot be given to a saloon car, an unapproved driver cannot be given anybody, and no driver carries two passengers at once | Driver **documents** — approval is a decision an admin records; the S3 upload behind it is still to come |
| Family invitations: single-use, expiring, email-bound, verified-address-bound, no grant broader than the inviter's | Live push: the client polls while a trip is running. The Socket.IO gateway is Stage 3 |
| Server-owned ride, appointment and **driver** state machines, with illegal transitions rejected | **Charging a card.** The fee model is real — two payers, plans, periods, seats, entitlements — but no money moves until Stage 4 wires Stripe up |
| `Idempotency-Key` honoured on every create — a retried request books one ride, not two | |
| Rate limits on every credential endpoint — sign-in, registration, reset, verification, invitation, MFA — counted per IP *and* per address, shared across instances through Redis | |
| Per-patient permission model resolved server-side on every request, **and** an organisation-membership model beside it for operator staff | The `ops_console`, the driver app, and everything in Stage 4 |
| Notification delivery on three channels with per-user, per-channel preferences | A real mail or push vendor — `MAIL_DRIVER=smtp` points at Mailpit locally and SES in production; `PUSH_DRIVER=fcm` is written and untested against a live project |
| BullMQ reminder scheduling, timezone-correct across both DST boundaries | Redis in the default local setup — without it the API falls back to an in-process scheduler and says so at boot |
| Geocoding behind the maps interface, with a deterministic dev adapter | A real maps vendor — `MAPS_DRIVER=google` is written; production refuses the deterministic one |
| Fare calculation in integer cents, itemised, versioned, priced from a `pricing_rules` row | S3 — MinIO is up, nothing writes to it until driver documents land |
| **Two-sided subscriptions** — a household plan and a dispatch operator priced by drivers on the road, monthly or annual, with graduated seat tiers, proration, a grace window and an append-only seat ledger | |
| Every fare settled once, at driver assignment: an operator on a per-driver plan keeps the whole fare, and which way it went is stamped on the ride | |
| Contentless notifications, fanned out to everyone with access, verified by test | |
| Location staleness, expiry and tracking-window enforcement, on the write path as well as the read path | |
| Append-only audit log, transactional with the change it describes | |
| Structured logging with the redaction denylist applied at the logger | |
| OpenAPI generated from the decorators → generated Dart client | |

Nothing in the preview controls takes a shortcut: they call the same
`POST /rides/:id/preview/start`, which drives the same `RidesService.transition`
a real driver's app will. When the driver app lands, that widget and
`ride-simulator.service.ts` are deleted and the state machine stays.

---

## Layout

```text
apps/api/                     NestJS modular monolith
├── prisma/
│   ├── schema.prisma         the domain model, §6 of FOUNDATION
│   ├── migrations/
│   └── seed.ts               fictional demo family; prices via the real engine
└── src/
    ├── common/               config (zod), error envelope, correlation ids,
    │                         pino + the redaction denylist, OpenAPI
    ├── domain/               pure rules — no Nest, no Prisma, no I/O
    │   ├── ride-status.ts            state machine + tracking window
    │   ├── appointment-status.ts     state machine + ride→appointment mapping
    │   ├── permissions.ts            per-patient access grants
    │   ├── pricing.ts / money.ts     versioned rules, integer cents,
    │   │                              and who the fare is split between
    │   ├── billing.ts                 payers, subscription lifecycle,
    │   │                              entitlements, calendar periods
    │   ├── subscription-pricing.ts    graduated seat tiers, proration
    │   ├── driver-status.ts           driver lifecycle; which status is billed
    │   ├── dispatch.ts                assignment eligibility, queue ordering
    │   ├── tracking.ts               freshness bounds (mirrored in the client)
    │   ├── eta.ts                    when to ask a routing vendor, and what
    │   │                              to say between asks
    │   ├── circuit-breaker.ts        a pure state machine, no clock of its own
    │   ├── driver-documents.ts       what is collected, and what approval waits on
    │   ├── feature-flags.ts          sticky percentage rollouts
    │   ├── clinic-visit.ts           checking in is not the ride completing
    │   ├── caregiver-booking.ts      rounding, commission, cancellation windows
    │   ├── caregiver-reputation.ts   what the platform says about a person —
    │   │                              and the words it never uses
    │   ├── totp.ts                   RFC 6238, against the published vectors
    │   ├── reminder-schedule.ts      offsets in local wall time, DST-correct
    │   └── notification-policy.ts    which channels, per event kind
    ├── infrastructure/       every vendor behind a port, two adapters each
    │   ├── prisma/  redis/  queue/   (BullMQ · in-process)
    │   ├── mail/                     (SMTP → Mailpit/SES · log)
    │   ├── push/                     (FCM HTTP v1 · log)
    │   └── maps/                     (Google · deterministic)
    ├── modules/
    │   ├── auth/             register · login · refresh · verify · reset ·
    │   │                     sessions · MFA
    │   ├── care/             the snapshot, invitations, reminders, devices,
    │   │                     notification delivery, geocoding
    │   ├── billing/          the plan catalogue, both billing accounts,
    │   │                     subscribe · change interval · cancel · seats
    │   ├── dispatch/         the roster, shifts, the queue, assignment
    │   ├── organizations/    the operator, and the membership axis of
    │   │                     authorisation
    │   ├── retention/        the schedule in docs/privacy, as a job
    │   ├── audit/  health/
    ├── test/                 integration harness + the negative-path helper set
    └── scripts/emit-openapi.ts

packages/
├── contracts/openapi.json    GENERATED from the decorators
├── dart/carebridge_api/      GENERATED from openapi.json — never hand-edited
├── dart/carebridge_client/   the request/refresh loop, failure taxonomy,
│                             secure token storage — shared by all three apps
├── typescript-config/        strict, noUncheckedIndexedAccess
└── eslint-config/            module boundaries · no console · no process.env

lib/                          Flutter — family + patient  (the pub workspace root)
├── core/          Money (integer cents), Clock, geo, formatting, failures
├── domain/        Pure business rules, mirroring the server's so controls can
│                  be disabled and prices shown — never so they can be enforced
│                  (including billing.dart and subscription_pricing.dart)
├── data/          CareState, the API client, the wire codec, token storage
├── state/         Riverpod providers
├── app/           Theme tokens, router, shell
├── widgets/       Shared accessible components
└── features/      auth (sign in, register, accept invitation) · dashboard ·
                   patients (detail, care circle) · clinics · appointments ·
                   rides (request, detail, tracking) · notifications ·
                   settings (account security, two-factor, notification
                   preferences, your plan)

apps/ops_console/             Flutter Web — the dispatcher's surface. A
                              separate origin and a separate image from the
                              family app, sharing the domain mirrors and the
                              generated client rather than reimplementing them.

apps/driver_app/              Flutter, Android + iOS — the one surface that
                              cannot be web, because it has to keep reporting
                              position with the screen off.
├── domain/       location_cadence.dart — how often to sample, and the one
│                 case where a flat battery outranks a fresh map
├── data/         driver_api.dart, location_queue.dart (the dead-zone buffer)
├── services/     position_source.dart (the port), location_service.dart
└── features/     auth · today (the shift, and what is on it) · job

infrastructure/nginx/         same-origin proxy, SPA fallback, CSP and the
                              other response headers the app is served with

infrastructure/terraform/     staging and production, sharing one set of
│                             modules and differing only in size and in what
│                             may be destroyed. Both `terraform validate` in CI.
├── modules/network/          VPC, three tiers, security groups by reference
├── modules/data/             RDS, ElastiCache, Secrets Manager
├── modules/storage/          the document bucket and the image registry
├── modules/ecs/              ALB, WAF, cluster, task, autoscaling
└── modules/observability/    alarms, each naming the next move
```

Dependencies point downward on both sides: `domain/` depends on nothing but
`core/` in Dart and on nothing but the error types in TypeScript. **The server's
copy is the one that decides anything**; the client's exists so a button can be
greyed out before the request is made.

---

## Design decisions worth knowing

**The client is not trusted with a state machine.** Every transition, permission
check and notification is decided by the API. The Dart mirror in `lib/domain/`
hides controls; it cannot authorise anything, and deleting it would change no
outcome except which buttons look tappable.

**Every mutation returns the whole snapshot.** One status change can touch a
ride, its appointment and the notification list at once. Returning a delta would
make the client responsible for reassembling three partial responses into a
consistent view, which is how a UI drifts out of step with the server it is
supposed to be following.

**"Not found" and "not permitted" are the same response.** Same message, same
404, decided in `common/errors.ts`. Neither can be used to probe for the other.
Authorisation resolves *up* the graph — ride → patient → grant — so a ride id is
never a capability.

**No date of birth.** Name + address + date of birth is the classic
re-identification triple. Nothing in arranging a car needs it, so an optional
coarse age band is collected instead. There is no such column in the schema.

**Notifications carry no detail.** No name, clinic, address or time — a phone on
a kitchen table is readable by whoever is in the room. They go to everyone with
an active grant on the patient, not only to whoever tapped the button. Enforced
by tests on both sides.

**Delay is a flag, not a status.** A driver stuck in traffic on the way to pickup
is still `driverEnRoute`; making delay a status would lose the state it must
return to.

**A retried request is not a second request.** A family taps "Request
transport", the connection drops before the response arrives, and the app
retries: at the HTTP level that is indistinguishable from booking a second car,
and no state machine can catch it because both requests are individually legal.
The client sends one `Idempotency-Key` per tap and the server claims it before
running the handler, so the retry is answered from the record rather than
performed. The body is hashed rather than kept — the same key with a different
body is a client bug and is refused, and storing the body to compare against
would mean a second copy of an address and an appointment time sitting around
for a day.

**A round trip is two rides.** Each leg is assigned, tracked, cancelled and
priced independently, and each snapshots its own copy of the two addresses — so
a patient moving house never rewrites where a completed ride actually went.

**Stale location is shown as stale.** Position is aged against when the device
took the reading, never when it was received. Past 45 seconds the screen says
so; past two minutes it stops showing a position at all. The same thresholds
gate the write path: a reading stamped in the future — which would otherwise
read as "just now" forever — or one that arrives already expired is refused, not
stored. The numbers live in `tracking.ts` and `models.dart` and are pinned by a
test on each side.

**Money never touches a float,** and both sides round the same way. Dart's
`num.round()` goes half away from zero; `Math.round` does not, so the server
reimplements it. A one-cent disagreement would show a total that did not match
its own line items — pinned in `pricing.spec.ts` and `pricing_test.dart`.

**Prices are rows, not constants.** The seed prices its demo ride by calling the
same engine a live request calls, so a seeded fare can always be explained by
its own rule version. The same is true of subscriptions: a plan is a
`subscription_plans` row with a version, copied onto every period it bills, and
the annual plan is a *separate row* rather than twelve times the monthly one —
the size of an annual discount is a commercial decision, and a commercial
decision must not be a deploy.

**Two parties pay, and neither pays twice.** A family subscribes for
coordination and pays the fare for each ride; a transport operator subscribes
for the dispatch console and driver app, priced by how many drivers it has on
the road. When the operator is on a plan, the platform's cut of the fare is
**zero** — our margin is their seats, taken a month earlier, and charging a
percentage as well would be charging twice for one relationship. Which way a
ride settled is stamped on it beside the pricing rule version, so a payout is
explicable months later. The whole rule is `settleFare` in `domain/pricing.ts`,
and the reasoning is in
[ADR-0011](docs/adr/0011-two-sided-subscription-billing.md).

**Driver seats are graduated, and the ladder never bites the operator for
growing.** Each driver is priced in the band they fall in, so adding one never
re-prices the ones below it. Volume pricing — the whole fleet at the rate the
total reaches — makes an invoice *fall* when a company hires, which is a
conversation that ends in a spreadsheet nobody trusts again. Adding a driver is
prorated and charged now; removing one takes effect at renewal and is not
refunded, because the seat stays usable until the period that paid for it ends.

**A failed payment does not blank the map.** A declined renewal moves a
subscription to `pastDue` and it keeps entitling for the plan's grace window —
seven days for a family, fourteen for an operator. The naive alternative cuts
live tracking off the instant a card expires, and the family's first signal that
anything is wrong is an empty screen while their mother is in a stranger's car.
Cancelling is likewise not an immediate switch-off: it runs to the end of the
period already paid for, because that period was paid for.

**Approving a driver moves money, in the same transaction.** A driver occupies
a billable seat exactly while their status is `approved` — one definition,
`occupiesSeat`, and `BillingService.recordSeatChange` is called inside the same
transaction as the status change. A failure cannot leave an operator
approved-but-unbilled or billed-but-offboarded, and neither of those is
discoverable without an audit. A driver who is suspended and reinstated inside
one period is **not** charged twice: proration measures against the period's
high-water mark, not the current head count.

**Assignment is asserted, not advised.** A wheelchair trip cannot be given to a
saloon car, an unapproved driver cannot be given anybody, and no driver carries
two passengers at once — all in `domain/dispatch.ts`, all throwing rather than
returning a boolean a caller can forget to read. A dispatcher under pressure at
8am should not be the last line of defence against a patient in a wheelchair
meeting the wrong vehicle at the kerb. The queue tells them *every* reason a
driver is unavailable, because "nobody is on shift" and "nobody has an
accessible vehicle" need different phone calls.

**The queue is ordered by when the car is needed, not by when the request
arrived.** A ride booked this morning for 4pm is not more urgent than one booked
five minutes ago for 2pm, and first-in-first-out quietly optimises for the
dispatcher's sense of fairness rather than for the person waiting. A pickup time
that has already passed with nobody assigned gets its own band — that is a
failure in progress, not an urgent task.

**A subscription is the one authorisation that outlives its own check.** Every
HTTP endpoint re-authorises on every request, because every request carries a
token. A WebSocket is checked once and then pays out for as long as it stays
open — all day, on a dispatcher's desk. Three things must stop a stream and
none of them would: the ride finishing, the watcher's access being revoked, and
the watcher signing out everywhere. So the gateway re-runs the whole check on a
fifteen-second timer, re-verifying the token — which is what carries the
`tokenVersion` comparison, and so what makes "sign out everywhere" reach an
open socket — and re-asking whether each joined room is still permitted. The
alternative, checking on every emitted position, would turn a Redis read into
two database queries at exactly the moment the system is busiest.

**A position expires in the store at the same moment it stops being a position
on screen.** The Redis key's TTL is `TrackingFreshness.lostMs` — the same
constant the client uses to stop drawing a marker, and the same one the write
path uses to refuse a reading that arrives already expired. One number in three
places, so there is no arrangement of them that shows a stale car as a moving
one. When a ride ends the position is *forgotten* rather than left to expire:
the TTL would take up to two minutes, and for those two minutes a finished
trip's last position would still be readable.

**Silence is the failure nothing else can see.** Every other alert in this
product is raised by something happening. A driver whose phone dies in a tunnel
produces no event at all — the position simply stops moving, and a stationary
car is indistinguishable from one at traffic lights. The client already ages a
position and says so, which covers whoever is looking; the staleness watchdog
covers the dispatcher who is not, because they are the one who can pick up a
phone.

**A ride nobody can take is a different problem from a ride nobody has taken
yet.** One needs a tap and the other needs a phone call, and a queue that
presents them identically buries the second behind the first. So the dispatch
API returns *every* reason each driver is unavailable rather than the first,
and the console counts them: "four off shift" is a different call from "nobody
has an accessible vehicle", and only one of those has a remedy the console can
suggest. The rides with nobody available are called out in the summary, above
the ones that merely need assigning.

**The console and the family app are separate origins.** Not a route inside one
bundle: they are different products for different people, and one origin would
mean every family downloads the dispatch code, every ops release re-deploys the
family app, and one XSS in either surface reaches both. Separate also means a
deployment can put the console behind an office allowlist without touching the
app somebody's daughter opens on a train. What they *do* share is the generated
client, the domain mirrors and — in `packages/dart/carebridge_client` — the
failure taxonomy: the API answers "no such record" and "not yours" identically
on purpose, and a second mapping of that envelope is exactly where the
ambiguity would get quietly undone.

**Nothing entitles forever, and the clock is a sweep.** A subscription used to
be written once and never moved: `isEntitling` answers `true` for `trialing`
and `active` without consulting a date, and nothing anywhere advanced either —
so a fourteen-day trial entitled live tracking permanently and no period was
ever billed. The failure is silent in both directions, which is why it survived:
nobody reports a subscription that never stops working, and nobody notices
revenue that was never invoiced. `BillingCycleService` is an hourly sweep rather
than a timer per renewal, for the reason the notification outbox is a sweep — a
job scheduled at renewal time can be lost by a restart or never created at all,
and a sweep cannot be forgotten. Its rules are pure and live in
`domain/billing-cycle.ts`; the service owns only the order of writes.

**A late sweep is late, not wrong.** A new period is anchored to the boundary
that was already scheduled, never to when the sweep happened to run. Anchoring
to `now` shifts the renewal date by the lateness of every pass and bakes each
shift into the next anchor, so a subscriber who bought on the 1st is billed on
the 9th by December.

**A charge is not transactional with the row that records it.** Collection is
three commits, not one: the attempt is claimed on the invoice, a `Payment` row
is written *before* the processor is called, and the outcome is recorded after.
The tempting single transaction can roll back after the money has moved, and
the next sweep — seeing no record — charges again. The payment row's id is the
idempotency key, so a retry of a lost response is answered from the processor's
record rather than performed.

**Four retries, and the last one has to land inside the grace window.** Dunning
runs at +1, +3 and +6 days, and the six is not a preference: the cycle sweep
expires a subscription the moment its grace closes, and the shortest grace any
plan offers is seven days. A schedule reaching past that would have its final
attempt scheduled against a subscription that no longer exists — a charge
silently never made, on the account that most needed the reminder. A card
reported stolen skips the schedule entirely, because three more attempts cannot
succeed and each one is a fraud signal recorded against us.

**A redelivered webhook is not a second payment.** Every processor event id is
claimed by a unique constraint rather than a check-then-write, so two workers
racing the same redelivery cannot both pass the check. The signature is verified
against the raw bytes — the endpoint is public by necessity and its URL is not
a secret — and the *local* adapter verifies too, so the branch that rejects a
forged "this invoice is paid" is the same code in development as in production.
An event type we do not handle is answered `200`: a processor retries non-2xx
for days and eventually disables the endpoint, which silently stops the events
we do handle.

**Dunning mail says what has not stopped before it says what failed.** On a
product whose purpose is knowing an elderly relative arrived safely, "your
payment failed" is read as "I have lost the ability to see where my mother is".
That is not what happened — the grace window exists precisely so nothing stops
immediately — and the message that actually gets a card updated is the calm one.
The wording is in `billing-mail.ts` and `lib/domain/invoicing.dart`, and a test
on each side holds it there.

**A permission and a subscription are different questions.** A ride request
checks both: whether this relative may book for this patient, and whether the
household is on a plan at all. Collapsing them would make a lapsed subscription
read as "you are not family".

**Every vendor sits behind a port with a local adapter, and production refuses
the local one.** A developer can run the whole product with no accounts: the
deterministic geocoder derives stable, plausible coordinates from address text,
the log mailer prints subjects, the in-process scheduler replaces BullMQ. Config
validation then fails the container at boot if any of them are configured in
production — each succeeds while doing nothing, which is the failure mode
hardest to notice. Password resets that never arrive look exactly like nobody
asking for one.

**Reminder offsets are measured in the clinic's local wall time.** Whole days
walk the calendar and the remainder is exact, so "the day before at 10:40" is
still 10:40 across a daylight-saving boundary — 23 or 25 real hours as
appropriate. Subtracting 1440 minutes from a UTC instant, the obvious
implementation, is wrong twice a year, and "your ride is tomorrow at 10:40"
arriving at 09:40 is the kind of bug that gets this product uninstalled by the
user who needed it most. Pinned by tests at both boundaries.

**Notification delivery is an outbox sweep, not a call at each site that
creates one.** Enqueuing inside the originating transaction produces jobs for
rows a rollback then removes; enqueuing after it means seven call sites have to
remember to, and one that forgets produces a notification the app shows and
nobody outside it ever hears about. A sweep cannot be forgotten. The consequence
is the right one: the timeline is never wrong even when delivery is.

**An invitation is not a capability either.** It is single-use, expiring, bound
to the invited email address, and acceptable only by an account that has
*verified* that address — otherwise anyone can register with it and accept.
Nobody may hand out access broader than they hold. FOUNDATION flags this as an
account-takeover vector; what it grants is standing access to a vulnerable
person's home address and daily movements.

**The app origin makes no third-party request, so its policy is `'self'`
throughout.** CanvasKit is built into the image rather than pulled from gstatic
at runtime, and Roboto is a bundled asset rather than the copy the web engine
fetches from `fonts.gstatic.com` on first paint. What that buys is a
Content-Security-Policy with no vendor in it: `connect-src 'self'` means a
script injected into this page has nowhere to send what it reads. It also
removes an unauthenticated request to a third party, made before the user has
agreed to anything, that says an IP address opened a medical-appointment app
and when. And it is what makes the app survive a bad network: CanvasKit has no
system font to fall back on, so a blocked font download renders every screen
with no text at all — verified, before the font was bundled, as a sign-in form
with three empty boxes.

**The redaction denylist is applied at the logger, not at call sites.** A
denylist enforced by remembering to scrub before each call fails the first time
someone logs a whole object during a 2am incident — which is exactly when the
most sensitive objects are being logged. `console` is banned by lint because it
bypasses it.

**There is one description of the API and it is the server code.** OpenAPI is
generated from the decorators, committed so a reviewer sees an API change in a
diff, and the Dart client is generated from that. CI fails a pull request whose
committed contract or client is stale — *and* analyses the regenerated output,
because a generator bug that emits a missing type produces a perfectly stable
diff and a client nobody can build.

**The app takes the generated models but not the generated transport.** One
HTTP client, because one client owns refresh: two of them each retrying a 401
will eventually both present the same rotated token, and reuse detection —
correctly — revokes the whole family and signs the user out. So `CareApi` stays
the single transport and decodes into the generated DTOs. The wire types are
imported under a `wire.` prefix, which keeps the app's own domain model primary
where the two share a name.

---

## Not built

Driver app · real maps and routing · S3 driver documents · caregiver
marketplace · clinic portal · Terraform and AWS.

Live tracking is pushed over a WebSocket, but the positions still come from the
server-side preview trip rather than from a driver's phone — there is no driver
app yet. The gateway, the position store, the authorisation and the staleness
watchdog are real; what feeds them is not.

Money moves, but only through the local adapter by default: `PAYMENTS_DRIVER`
selects between it and Stripe, and the Stripe path is written and typed but has
not been exercised against a live account.

CareBridge coordinates appointments and transport. It is not an EHR, not a
medical service, and not an emergency service.
