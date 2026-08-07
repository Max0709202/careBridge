# CareBridge — family app + API

Coordinate an older relative's medical appointments and the transportation to
them, and know they arrived safely.

This repository holds the **family/patient Flutter app** and the **NestJS API**
it runs against. The plan it is being built to — product, architecture, five
stages, domain model, security — is in [docs/FOUNDATION.md](docs/FOUNDATION.md).

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

Three containers come up: PostgreSQL 16, the API, and the Flutter web app behind
nginx. Migrations apply on start and the demo family is seeded (idempotently —
set `SEED_ON_START=false` for an empty database). Everything you do is written
to Postgres and survives `docker compose restart`.

| | |
| --- | --- |
| App | <http://localhost:8080> |
| API | <http://localhost:8080/api/v1> (proxied), or `:3000` directly |
| Health | <http://localhost:8080/api/v1/health> |
| Postgres | `localhost:55432` (loopback only) |

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
flutter analyze              # clean
flutter test                 # 60 tests

cd apps/api
npm install
npm run lint                 # tsc --noEmit
npm test                     # 43 tests
```

Needs the **Flutter stable SDK 3.44.x** (Dart 3.12) for the app, and Node 22 for
the API. Neither is needed to run the stack — Docker builds both.

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
| PostgreSQL is the source of truth. Nothing resets on restart. | The **driver app** — "Preview controls" ask the server to run the same transitions |
| Authentication: argon2id, short-lived JWTs, rotating refresh tokens with family revocation on reuse | The **dispatch service** — assignment is scripted, not matched |
| Server-owned ride and appointment state machines, with illegal transitions rejected | Real GPS, maps and routing — the route view is a schematic, deliberately, and positions come from the preview runner |
| Per-patient permission model resolved server-side on every request | Live push: the client polls while a trip is running. The Socket.IO gateway is Stage 3 |
| Fare calculation in integer cents, itemised, versioned, priced from a `pricing_rules` row | Payments, subscriptions, family invitations |
| Contentless notifications, fanned out to everyone with access, verified by test | Email and push delivery — notifications are in-app only |
| Location staleness, expiry and tracking-window enforcement, on the write path as well as the read path | Redis, BullMQ, S3 — not yet needed by anything that is built |
| Append-only audit log, transactional with the change it describes | The `ops-console`, the driver app, and everything in Stage 4 |

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
    ├── common/               config (zod), error envelope, correlation ids
    ├── domain/               pure rules — no Nest, no Prisma, no I/O
    │   ├── ride-status.ts            state machine + tracking window
    │   ├── appointment-status.ts     state machine + ride→appointment mapping
    │   ├── permissions.ts            per-patient access grants
    │   ├── pricing.ts / money.ts     versioned rules, integer cents
    │   └── tracking.ts               freshness bounds (mirrored in the client)
    ├── infrastructure/prisma/
    └── modules/
        ├── auth/             register · login · refresh · logout
        ├── care/             the snapshot, and every mutation over it
        ├── audit/
        └── health/

lib/                          Flutter — family + patient
├── core/          Money (integer cents), Clock, geo, formatting, failures
├── domain/        Pure business rules, mirroring the server's so controls can
│                  be disabled and prices shown — never so they can be enforced
├── data/          CareState, the API client, the wire codec, token storage
├── state/         Riverpod providers
├── app/           Theme tokens, router, shell
├── widgets/       Shared accessible components
└── features/      auth · dashboard · patients · clinics · appointments ·
                   rides (request, detail, tracking) · notifications · settings

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

---

## Not built

Payments and subscriptions · family invitations · push and email delivery ·
driver app · dispatcher console · `ops-console` · real maps and routing ·
WebSocket tracking · Redis and BullMQ · caregiver marketplace · clinic portal ·
Terraform and AWS.

CareBridge coordinates appointments and transport. It is not an EHR, not a
medical service, and not an emergency service.
