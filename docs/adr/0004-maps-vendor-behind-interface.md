# ADR-0004 · One maps vendor, behind an interface

**Status:** Accepted · **Routing landed** in Stage 3 · **Date:** 2026-07-27

## Context

We need geocoding (Stage 2), map rendering and routing/ETA (Stage 3). Map and
routing spend **scales with tracked rides**, not with users — which makes it
the one vendor cost that grows exactly as the product succeeds (risk R4).

## Decision

One vendor covers all three (T6), and every call goes through a **port** —
`MapsPort`, with `geocode` and, since Stage 3, `route`.

Routing uses Google's **Routes API** with `TRAFFIC_AWARE`, not
`TRAFFIC_AWARE_OPTIMAL`: the optimal mode costs several times as much for an
accuracy difference measured in seconds, and this is the one vendor cost that
grows exactly as the product succeeds. The request carries a **field mask**
asking for two numbers — duration and distance — because the endpoint is billed
by what is requested and the default set returns a polyline and turn-by-turn
instructions this product has no use for.

Two adapters exist from day one:

- `GoogleMapsAdapter` — the real one.
- `DeterministicMapsAdapter` — no network, no key, no drift. It derives stable
  coordinates from a SHA-256 of the normalised address, placed inside the
  bounding box of the US state in that address.

## Why the deterministic adapter is not "a fake"

It has three properties that a mock does not:

- **Deterministic.** The same address yields the same coordinates on every
  machine and every run, so a test can assert on a distance and a seeded demo
  shows every developer the same map. Its `route` is a straight line at a
  conservative city average — which is *exactly* the estimate the system falls
  back to when a real vendor is unreachable, so a developer running without a
  key sees the degraded answer rather than a fictional traffic-aware one.
- **Plausible.** Coordinates land in the right part of the country, so a
  rendered map looks like a map and a distance between two addresses in one
  city is a city-sized number.
- **Honest.** `precision` is always `approximate` and `source` records which
  adapter produced it, so nothing downstream can mistake it for a rooftop fix.

## Alternatives

**Call Google directly from the services.** Cheaper to write once, and it makes
"change vendor" a search-and-replace across the codebase, tests that need a
network and an API key, and no way to run the product without a billing
account. Rejected.

**Two vendors from the start** — one for geocoding, one for routing. More
negotiating leverage, twice the integration surface, and no evidence yet that
either matters. Rejected for now; the port is what keeps it cheap later.

## Consequences

- Production **refuses** the deterministic adapter. Config validation fails the
  container at boot — a geocoder that invents confident coordinates would send
  a driver to a plausible wrong address.
- Geocoding happens on **write**, never on read. A geocoding call on a read
  path turns a vendor outage into a page that will not load, and turns a list
  of fifty clinics into fifty billable lookups.
- **`geocode` swallows failures; `route` throws.** The asymmetry is deliberate.
  Geocoding runs while somebody is creating a clinic or saving a patient's
  address, where a vendor outage must not become a form that will not submit.
  Routing runs behind a position report, where the caller has a real fallback
  and needs to know both to use it and to stop calling — which a circuit
  breaker cannot decide without being able to tell "no route exists" from "we
  do not know".
- **Routing is cached and broken-circuited, and neither is optional.** A
  position report arrives every four to ten seconds per ride; one lookup each
  would cost roughly $0.60 on a half-hour trip against a ceiling of $0.50 a
  ride. A route is reused for a minute, aged by the time that has passed, and
  recomputed only when it stops describing where the car is. Separately, three
  consecutive vendor failures stop the calls for thirty seconds — not to
  protect the vendor, but because each failed call costs a three-second
  timeout and a hundred live rides would otherwise become a hundred sockets
  waiting.
- **An implausible answer is discarded, not clamped.** A number quietly bent
  into range is indistinguishable from a real one; the straight-line fallback
  is at least honestly derived.
- A failed lookup returns `null` rather than throwing. People mistype
  postcodes; a typo must not block the creation of a clinic record.
- No patient identity leaves the process — the request carries an address
  string and nothing else.

## Revisit when

- Map spend per tracked ride exceeds $0.50 — now measurable rather than
  hypothetical, since every routing call goes through one service (see
  [../product/success-metrics.md](../product/success-metrics.md)).
- Geocoding accuracy is measurably poor for the pilot metro area.
- A vendor's terms change with respect to retention of submitted addresses.
