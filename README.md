# CareBridge — family app

Coordinate an older relative's medical appointments and the transportation to
them, and know they arrived safely.

This repository currently holds the **family/patient Flutter app**. The plan it
is being built against — product, architecture, five stages, domain model,
security — is in [docs/FOUNDATION.md](docs/FOUNDATION.md).

---

## Run it

Needs the **Flutter stable SDK, 3.44.x or newer** (Dart 3.12.2 — the constraint
in `pubspec.yaml`). Nothing else: no API keys, no Docker, no backend.

```bash
flutter pub get

flutter run -d chrome     # or: -d windows
flutter test              # 81 tests
flutter analyze           # clean
flutter build web --release
```

The app has no plugin dependencies, so it builds on any target without Developer
Mode or native toolchain setup. Running on `-d chrome` needs `CHROME_EXECUTABLE`
set if Chrome is not on the default path; `-d linux` additionally needs
`clang cmake ninja-build pkg-config libgtk-3-dev`, which the web target does not.

**Sign in with the pre-filled credentials** to explore a seeded family, or
**create an account** to see the genuine first-run empty state.

### Try the whole journey

1. Sign in → the dashboard shows Eleanor's cardiology follow-up in two days,
   with a round trip booked and awaiting a driver.
2. Tap the ride → **Follow the trip** → **Assign a driver and run the trip**.
3. Watch it run: driver assigned → on the way → arrived → picked up → in
   progress → arrived at the clinic → completed. The position updates, the ETA
   counts down, the freshness label ages, notifications accumulate, and the
   appointment status follows the ride.
4. Hit **Report a delay** mid-trip. Pause the trip and watch the location go
   stale, then lost — the marker hollows out and the banner turns red.

---

## What is real and what is standing in

| Real | Standing in |
| ---- | ----------- |
| Ride and appointment state machines, with illegal transitions rejected | The **driver app** — "Preview controls" drive the same state machine |
| Per-patient permission model gating every action, and every patient-scoped screen | The **dispatch service** — assignment is scripted |
| Fare calculation in integer cents, itemised, versioned | The **NestJS API** — all state is in memory and resets on restart |
| Contentless notifications, verified by test | Authentication — credentials are not checked, and the sign-in screen says so |
| Location staleness, expiry, and tracking-window enforcement | Real GPS, maps, and routing — the route view is a schematic, deliberately |
| Accessibility: 44px targets, 17px base text, icon+word status, semantics | Payments, subscriptions, family invitations |

Nothing in the preview controls takes a shortcut: they call the same
`advanceRide` the server will own. When the API lands, that widget is deleted
and the state machine stays.

---

## Layout

```text
lib/
├── core/          Money (integer cents), Clock, geo, formatting, failures
├── domain/        Pure business rules — no Flutter, no I/O
│   ├── ride_status.dart          state machine + tracking window
│   ├── appointment_status.dart   state machine + ride→appointment mapping
│   ├── permissions.dart          per-patient access grants
│   ├── pricing.dart              versioned pricing rules
│   └── models.dart               entities
├── data/          CareState + pure `CareState -> CareState` operations, seed
├── state/         Riverpod providers, demo trip runner
├── app/           Theme tokens, router, shell
├── widgets/       Shared accessible components
└── features/      auth · dashboard · patients · clinics · appointments ·
                   rides (request, detail, tracking) · notifications · settings
```

Dependencies point downward: `domain/` depends on nothing but `core/`, and every
business rule lives there or in `data/care_operations.dart` — never in a widget.

---

## Design decisions worth knowing

**No date of birth.** Name + address + date of birth is the classic
re-identification triple. Nothing in arranging a car needs it, so an optional
coarse age band is collected instead.

**Notifications carry no detail.** No name, clinic, address or time — a phone on
a kitchen table is readable by whoever is in the room. Enforced by a test.

**Delay is a flag, not a status.** A driver stuck in traffic on the way to pickup
is still `driverEnRoute`; making delay a status would lose the state it must
return to.

**A round trip is two rides.** Each leg is assigned, tracked, cancelled and
priced independently, and the return leg's pickup time is genuinely unknown when
the outbound leg is booked.

**Stale location is shown as stale.** Position is aged against when the device
took the reading, never when it was received. Past 45 seconds the screen says
so; past two minutes it stops showing a position at all. False certainty about
where a vulnerable person is would be worse than no map. The same thresholds
gate the write path: a reading stamped in the future — which would otherwise
read as "just now" forever — or one that arrives already expired is refused, not
stored.

**A ride id is not a capability.** Access resolves up the graph: ride → patient
→ grant. Every screen that renders a person, an appointment or a live position
checks that grant first, so a revoked grant closes every surface at once. "Not
found" and "not permitted" are the same screen, so neither can be used to probe
for the other.

**Money never touches a float.** Integer cents throughout.

---

## Not built

Payments and subscriptions · family invitations · push and email delivery ·
driver app · dispatcher console · the NestJS API and its database · real maps
and routing · caregiver marketplace · clinic portal.

CareBridge coordinates appointments and transport. It is not an EHR, not a
medical service, and not an emergency service.
