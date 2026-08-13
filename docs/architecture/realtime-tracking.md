# Real-time tracking

Stage 3. This document is the design; the code lands with the driver app.

**This is a P0 security surface.** A WebSocket authorisation error leaks a
patient's live position. Everything below is shaped by that.

## Permission and consent

The driver app explains, in plain language, that location is shared with the
family **only while a ride is active** and stops automatically at completion.
Consent is recorded server-side with a timestamp and a document version.

## Capture

Tracking starts on transition to `driverEnRoute` and stops on `completed`,
`canceled` or `noShow`.

- **Android**: a foreground service with a persistent notification, so the
  driver can always see that it is on.
- **iOS**: while-in-use background location. We avoid the "Always" entitlement
  until a real trip proves we need it (T2) — it is the entitlement most likely
  to fail store review and the one users most distrust.

**Cadence adapts:** roughly 5 s while moving, 30 s while stationary, paused
entirely when the device has not moved beyond the accuracy radius. This is a
battery, data and cost decision as much as an accuracy one — and battery drain
is a *revenue* risk, because a driver who disables the app removes the product
(R2).

## Transport

Points go over the authenticated Socket.IO connection, batched when several
have queued. On network loss the app buffers a **bounded** ring of about 100
points, retries with jittered backoff, and drops the oldest rather than growing
without limit. A queue that grows without limit in a dead zone is an app that
gets killed by the OS at the worst moment.

## Server authorisation — the security-critical step

For **every inbound point** the server verifies:

1. The socket is authenticated.
2. The sender is the driver **currently assigned** to that ride.
3. The ride is in a state where tracking is legal.
4. The timestamp is sane.

Anything else is rejected and audited.

Subscription is guarded **symmetrically**: joining `ride:{id}` requires an
authorisation check that the subscriber is a permitted family member, the
assigned driver, or ops staff for the owning organisation.

**A ride id is not a capability.** It appears in URLs, in notification payloads
and in logs; treating possession of one as permission would make every one of
those a disclosure.

### The tests this implies

- An unassigned driver's point is rejected.
- An unrelated family member's subscription is rejected.
- A subscription *after* completion is rejected.
- A point sent after completion is rejected — and the assertion is that it
  stops within seconds, not eventually.

## Storage

| What | Where | Lifetime |
| ---- | ----- | -------- |
| Latest position | Redis, `ride:{id}:location` | TTL ~2 minutes |
| Sampled history | Postgres, `ride_location_samples` | **30 days**, enforced by the retention job |

Every ~30 seconds, plus every state transition. We do not keep every point
forever: writing 500 rides × 0.2 Hz to Postgres would be a self-inflicted
wound, and retaining it would be a privacy liability with no operational use.

## Distribution

The gateway publishes to a Redis-backed room; subscribers receive
`{lat, lng, accuracy, heading, capturedAt, etaSeconds}`.

**`capturedAt` is when the device took the reading**, not when the server
received it. Every freshness label ages against it. Clients render that age
explicitly and switch to a "last seen HH:MM" state past the staleness
threshold.

A server-side watchdog raises a dispatcher alert when an active ride goes
quiet.

## ETA

Recomputed on a throttle — roughly every 60 seconds or on significant movement
— via the routing vendor, cached in Redis, behind a circuit breaker, and
**always presented as a range, never a to-the-minute promise.**

## The rule the whole design serves

**Tracking must be honest.**

A stale position rendered as a confident moving car is worse than no map at
all, because it manufactures false certainty about a vulnerable person. So no
interpolation, no smoothing that hides an accuracy drop, no "estimated
position". A visible gap is the correct rendering of a gap.
