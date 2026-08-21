# Real-time tracking

Stage 3, and now **built end to end**: the driver app samples, the API stores
and fans out, and the family app draws it. Where the implementation departs
from the design below, the design has been updated and the departure is stated
rather than quietly reconciled — see *Transport*.

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

**Cadence adapts**, and the governing idea is that it follows *how fast the
answer is changing*, not how much anyone cares about it — the moment a family
is refreshing hardest is often the moment the car is standing still at a light.
The rule lives in `apps/driver_app/lib/domain/location_cadence.dart`:

| situation | interval |
| --- | --- |
| approaching the pickup, moving | 4 s |
| driving, carrying a passenger | 10 s |
| stationary, or parked at a kerb | 25 s |
| battery under 15%, not charging | 30 s |
| battery under 5%, not charging | 90 s |
| ride not in a state that permits sharing | not sampling |

Every interval except the last two is inside the 45-second staleness bound, so
a healthy device is never labelled out of date. **The 90-second one breaks that
deliberately**: below five per cent the app accepts a visibly stale marker in
exchange for leaving the driver a phone that can still run a navigation app and
make a telephone call. A stale marker with a working driver behind it is a far
better outcome than a fresh marker that stops for good twenty minutes later.

Asking the platform for a longer interval is what actually reduces the radio
duty cycle, so a change of band means a new subscription — which restarts the
Android foreground service. That is why the rule returns one of a handful of
values rather than a continuous function: re-subscribing is a real cost, and it
should happen a few times a ride rather than continuously.

This is a battery, data and cost decision as much as an accuracy one — and
battery drain is a *revenue* risk, because a driver who disables the app
removes the product (R2).

## Transport

**Departure from the original design.** Points go up over **HTTP**, batched, to
`POST /driver/rides/:rideId/locations` — not over the Socket.IO connection the
design first called for. The socket carries positions *out* to watchers and
nothing in. Four reasons, in order of weight:

1. **The write path needs the request pipeline.** Idempotency, rate limiting,
   correlation ids, request logging and the audit context are all wired to HTTP
   in this codebase. A write handler inside a gateway would have none of them,
   and would grow its own versions.
2. **A flush needs an answer.** The app has to know what was stored and what
   was refused before it can drop anything from the queue. That is a
   request/response shape; a push is not.
3. **The dead zone is exactly when the socket is down.** A batch upload has to
   work the instant a single request can complete, which is well before a
   WebSocket will hold open.
4. **It keeps the gateway one-directional**, which is a much smaller surface to
   reason about for something FOUNDATION marks P0.

On network loss the app buffers a bounded queue — 720 fixes, two hours at the
fastest cadence — and **drops the oldest**. Right way round twice over: the
newest fix is the one that will move the family's map, and the oldest is the
one the server is most likely to refuse as backlog anyway. A queue that grows
without limit in a dead zone is an app the OS kills at the worst moment.

Retrying is safe without a backoff schedule to get wrong: `(rideId, capturedAt)`
is unique, and a device takes one reading per instant, so re-sending a batch
whose response was lost inserts nothing. The queue is **not** persisted across
an app restart — the ride row still holds the last position the server
received, so a restart re-reads rather than reconstructs, and persisting would
mean writing a stream of somebody's locations to disk on the device in this
system most likely to be lost or left in a vehicle.

A batch that drains late is kept as **history but does not move the map**: its
readings belong in the journey record, and they must not overwrite a fresher
position the family is already looking at. A batch arriving after the ride has
ended is refused whole rather than filtered — location stops being collectable
the moment the ride is over.

## The arrival estimate

The number the product is named for — "the driver is six minutes away" — is
computed **server-side, from the reported position**, and never taken from the
client. There is deliberately no `etaMinutes` field on the inbound position
report. An ETA is a promise made to somebody waiting by a window, and a field
the reporting device could set would let anything holding a driver's token hold
a family at "two minutes" indefinitely.

What it counts down to depends on where the ride is: the pickup while the
driver is on the way, the destination once the passenger is in the car, and
**nothing at all** while the car is standing at a kerb. "Arriving in 1 minute"
beside a driver who is already at the door is worse than no number — it is the
number that makes somebody keep waiting inside.

Three things sit between the claim and the vendor:

| | why |
| --- | --- |
| **Cache** | A route is reused for a minute and aged by the time that has passed. Position reports arrive every four to ten seconds; a lookup each would cost roughly $0.60 on a half-hour trip, against a ceiling of $0.50 a ride (R4). It is recomputed early when the stop changes or the car strays half a mile from where the route was measured. |
| **Circuit breaker** | Three consecutive failures stop the calls for thirty seconds. Not to protect the vendor: each failed call costs a three-second timeout, and a hundred live rides would otherwise be a hundred sockets waiting while the API stops being able to do anything else. |
| **Fallback** | A straight line at a conservative city average. Worse than a real route and enormously better than a blank space where an arrival time was. |

An answer no road produces — a ferry leg, a closed road, a units mix-up — is
**discarded rather than clamped**, because a number quietly bent into range is
indistinguishable from a real one and the fallback is at least honestly
derived.

A batch flushed after a dead zone routes **once**, for the newest reading only.
Twenty positions from a tunnel are history; the question being answered is
where the car is now.

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
