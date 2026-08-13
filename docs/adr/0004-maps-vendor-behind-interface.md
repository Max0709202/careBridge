# ADR-0004 · One maps vendor, behind an interface

**Status:** Accepted · **Date:** 2026-07-27

## Context

We need geocoding (Stage 2), map rendering and routing/ETA (Stage 3). Map and
routing spend **scales with tracked rides**, not with users — which makes it
the one vendor cost that grows exactly as the product succeeds (risk R4).

## Decision

One vendor covers all three (T6), and every call goes through a **port** —
`MapsPort`, with `geocode` today and routing added in Stage 3.

Two adapters exist from day one:

- `GoogleMapsAdapter` — the real one.
- `DeterministicMapsAdapter` — no network, no key, no drift. It derives stable
  coordinates from a SHA-256 of the normalised address, placed inside the
  bounding box of the US state in that address.

## Why the deterministic adapter is not "a fake"

It has three properties that a mock does not:

- **Deterministic.** The same address yields the same coordinates on every
  machine and every run, so a test can assert on a distance and a seeded demo
  shows every developer the same map.
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
- A failed lookup returns `null` rather than throwing. People mistype
  postcodes; a typo must not block the creation of a clinic record.
- No patient identity leaves the process — the request carries an address
  string and nothing else.

## Revisit when

- Map spend per tracked ride exceeds $0.50 (see
  [../product/success-metrics.md](../product/success-metrics.md)).
- Geocoding accuracy is measurably poor for the pilot metro area.
- A vendor's terms change with respect to retention of submitted addresses.
