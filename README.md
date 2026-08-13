# CareBridge — family app + API

Coordinate an older relative's medical appointments and the transportation to
them, and know they arrived safely.

This repository holds the **family/patient Flutter app**, the **NestJS API** it
runs against, and the generated Dart client between them. The plan it is being
built to — product, architecture, five stages, domain model, security — is in
[docs/FOUNDATION.md](docs/FOUNDATION.md), expanded across
[docs/](docs/README.md): eight product documents, nine architecture documents
and ten ADRs.

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

Six containers come up: PostgreSQL 16, Redis 7, Mailpit, MinIO, the API, and the
Flutter web app behind nginx. Migrations apply on start and the demo family is
seeded (idempotently — set `SEED_ON_START=false` for an empty database).
Everything you do is written to Postgres and survives `docker compose restart`.

| | |
| --- | --- |
| App | <http://localhost:8080> |
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

### Checks

```bash
make check
```

Format, lint, typecheck, unit tests and the API-contract drift check — exactly
what CI runs, in CI's order. If the two ever diverge, CI is what is wrong.

```bash
make test-integration        # 72 tests, real app against real Postgres
```

Individually:

```bash
pnpm --filter @carebridge/api test          # 110 unit tests
pnpm --filter @carebridge/api exec eslint . # boundaries, no-console, no process.env
flutter analyze && flutter test             # the app
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
| Full auth lifecycle: argon2id, rotating refresh tokens with family revocation, email verification, password reset, session list and revoke, sign-out-everywhere | The **dispatch service** — assignment is scripted, not matched |
| TOTP MFA end to end — enrol, confirm, sign in with a code, spend a recovery code — verified against the RFC 6238 vectors, secret encrypted at rest | Real GPS, maps and routing — the route view is a schematic, deliberately, and positions come from the preview runner |
| Family invitations: single-use, expiring, email-bound, verified-address-bound, no grant broader than the inviter's | Live push: the client polls while a trip is running. The Socket.IO gateway is Stage 3 |
| Server-owned ride and appointment state machines, with illegal transitions rejected | Payments and subscriptions |
| Per-patient permission model resolved server-side on every request | The `ops_console`, the driver app, and everything in Stage 4 |
| Notification delivery on three channels with per-user, per-channel preferences | A real mail or push vendor — `MAIL_DRIVER=smtp` points at Mailpit locally and SES in production; `PUSH_DRIVER=fcm` is written and untested against a live project |
| BullMQ reminder scheduling, timezone-correct across both DST boundaries | Redis in the default local setup — without it the API falls back to an in-process scheduler and says so at boot |
| Geocoding behind the maps interface, with a deterministic dev adapter | A real maps vendor — `MAPS_DRIVER=google` is written; production refuses the deterministic one |
| Fare calculation in integer cents, itemised, versioned, priced from a `pricing_rules` row | S3 — MinIO is up, nothing writes to it until driver documents land |
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
    │   ├── pricing.ts / money.ts     versioned rules, integer cents
    │   ├── tracking.ts               freshness bounds (mirrored in the client)
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
    │   ├── retention/        the schedule in docs/privacy, as a job
    │   ├── audit/  health/
    ├── test/                 integration harness + the negative-path helper set
    └── scripts/emit-openapi.ts

packages/
├── contracts/openapi.json    GENERATED from the decorators
├── dart/carebridge_api/      GENERATED from openapi.json — never hand-edited
├── typescript-config/        strict, noUncheckedIndexedAccess
└── eslint-config/            module boundaries · no console · no process.env

lib/                          Flutter — family + patient  (the pub workspace root)
├── core/          Money (integer cents), Clock, geo, formatting, failures
├── domain/        Pure business rules, mirroring the server's so controls can
│                  be disabled and prices shown — never so they can be enforced
├── data/          CareState, the API client, the wire codec, token storage
├── state/         Riverpod providers
├── app/           Theme tokens, router, shell
├── widgets/       Shared accessible components
└── features/      auth (sign in, register, accept invitation) · dashboard ·
                   patients (detail, care circle) · clinics · appointments ·
                   rides (request, detail, tracking) · notifications ·
                   settings (account security, two-factor, notification
                   preferences)

infrastructure/nginx/         same-origin proxy + SPA fallback
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
its own rule version.

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

Payments and subscriptions · driver app · dispatcher console · `ops_console` ·
real maps and routing · WebSocket tracking · S3 document upload · caregiver
marketplace · clinic portal · Terraform and AWS.

CareBridge coordinates appointments and transport. It is not an EHR, not a
medical service, and not an emergency service.
