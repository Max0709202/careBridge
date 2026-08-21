# ADR-0005 · Foreground-service location first

**Status:** Accepted · **Implemented** in `apps/driver_app` · **Date:** 2026-07-27

## Context

The driver app must report position while a ride is active. Both platforms
offer more than one way to do it, and they differ sharply in what they cost in
store review, battery, and user trust.

This is risk R2, and it has a commercial edge: a driver who disables location
removes the product's core feature.

## Decision

**Android:** a foreground service with a persistent notification.
**iOS:** while-in-use background location. We do **not** request the "Always"
entitlement in v1 (T2).

Tracking starts on `driverEnRoute` and stops the moment the ride leaves a state
that permits sharing. Cadence adapts — 4 s approaching a pickup, 10 s driving,
25 s stationary — and backs off further on a low battery. See
`docs/architecture/realtime-tracking.md` for the full table and for the one
case where the app accepts looking stale in order to leave the driver a working
phone.

## Alternatives

**iOS "Always" authorisation.** More reliable when the app is backgrounded for
a long period. Against it: it is the entitlement most likely to draw store
scrutiny, it requires the strongest justification, and it is the one users most
distrust — the permission dialog itself is a moment where a driver decides
whether to keep the app.

**Significant-location-change only.** Far cheaper on battery, and far too
coarse: the whole product claim is "the driver is 6 minutes away".

**Third-party background-location SDKs.** Solve the platform problem and add a
vendor with access to every driver's continuous position. Rejected on privacy
grounds before cost.

## Consequences

- The persistent Android notification is a **feature**: the driver can always
  see that tracking is on, which is the honest version of this permission.
- Tracking is bounded by the ride's lifecycle, which is what makes the consent
  copy true. "Only while a ride is active, and it stops automatically" has to
  be enforced, not merely promised.
- Adaptive cadence is a battery, data *and* cost decision — every point is also
  a write and, downstream, an ETA recalculation.
- Platform-channel work for the Android foreground service is accepted cost.
  **In the event it was not needed**: `geolocator`'s
  `ForegroundNotificationConfig` provides the service, so no platform channel
  was written. `ACCESS_BACKGROUND_LOCATION` is deliberately not requested —
  the service runs only while a ride is under way, and asking for the always-on
  permission would be asking for more than the product does.

## Revisit when

- A **real-device field test** — a Stage 3 acceptance item — shows while-in-use
  is insufficient for realistic trips, particularly long waits at a clinic.
- Battery drain exceeds 25% over a four-hour shift.
- Either platform changes its policy in a way that forces the question.

The field test is the deciding evidence, and it is scheduled before the
decision would need to change.
