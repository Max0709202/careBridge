# Success metrics

Every metric below has a **stop condition**: a number that, if we hit it, means
something is wrong with the thesis rather than with the execution. A metric
without one is a vanity metric.

## The one that matters

**Calls to dispatch per completed ride.**

This is the product's whole claim in a single number. If a family can watch the
journey, they do not phone to ask about it — and the operator's dispatch line
gets quieter, which is why the operator renews.

- Baseline: measured with the pilot operator before launch.
- Target: **a 50% reduction** within two months of a family's first tracked ride.
- **Stop condition:** no measurable reduction after 100 tracked rides. If
  families still call, the map is not doing the job the whole architecture is
  built around.

## Product health

| Metric | Target | Stop condition |
| ------ | ------ | -------------- |
| Family weekly active, of households with an upcoming appointment | > 70% | < 40% — the dashboard is not worth opening |
| Median time from opening the app to knowing "is it on track" | < 5 seconds, no interaction | Any interaction required to answer it |
| Rides tracked end to end, of rides assigned | > 90% | < 70% — the driver app is failing in the field |
| Appointments with transport requested | > 60% | < 30% — we are a calendar, not a coordination product |

## Reliability of the promise

These are the numbers behind "tracking must be honest".

| Metric | Target | Stop condition |
| ------ | ------ | -------------- |
| Position staleness at any render, p95 | < 30 seconds | > 2 minutes — the map is lying by omission |
| Location writes rejected after ride completion | 100% | Any accepted write |
| Driver-app battery drain over a 4-hour shift | < 15% | > 25% — drivers will disable it, and R2 is realised |
| Transitions lost to connectivity | 0 (queued and reconciled) | Any lost transition |

## Operations

| Metric | Target | Stop condition |
| ------ | ------ | -------------- |
| Time from ride request to assignment, median | < 15 minutes | > 1 hour — the dispatcher surface is inadequate (R1) |
| No-show rate | < 3% | > 8% |
| Pickup within 10 minutes of scheduled | > 85% | < 60% |

## Commercial

| Metric | Target | Stop condition |
| ------ | ------ | -------------- |
| Households converting from trial | > 25% | < 10% — families will not pay for this |
| Monthly churn | < 5% | > 12% |
| Map and routing spend per tracked ride | < $0.15 | > $0.50 — R4 is realised and the unit economics do not work |
| Payment success on first attempt | > 95% | < 85% |

## Safety and privacy — not targets, thresholds

These have no "good" number. Any occurrence is an incident.

- Personal data appearing in a log line: **zero**.
- A location visible to someone without a grant: **zero**.
- An audited action that succeeded without its audit row: **zero**.
- A notification body containing a patient name, clinic name, address or
  appointment time: **zero**.

The first three are enforced by tests that run on every pull request. The
fourth is asserted against real notification bodies in
`apps/api/test/notifications.e2e-spec.ts`, not against a template.

## What we are deliberately not measuring in the pilot

Growth rate, virality, and anything that depends on volume we will not have.
The pilot runs with one operator in one metro area (O1). Its job is to falsify
the thesis cheaply, not to look like traction.
