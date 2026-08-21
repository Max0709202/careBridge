# Documentation

| Where | What |
| ----- | ---- |
| [FOUNDATION.md](FOUNDATION.md) | The gate document: understanding, assumptions, scope, architecture, the five-stage plan, the domain model, the API surface, the security plan, the first twenty tasks |
| [product/](product/) | Eight documents — problem, vision, personas, journeys, scope, non-goals, business model, success metrics |
| [architecture/](architecture/) | Nine documents — overview, containers, domain model, data flow, security, tenancy, tracking, deployment, disaster recovery |
| [adr/](adr/) | Twelve decision records, each with what we rejected and what would make us revisit |
| [privacy/](privacy/) | The data map and the retention schedule |
| [runbooks/](runbooks/) | Procedures followed under time pressure |

## Reading order

**New to the project:** `product/problem.md` → `product/vision.md` →
`architecture/system-overview.md`.

**About to write code:** `../CONTRIBUTING.md` →
`architecture/security-model.md` → the ADR for whatever you are touching.

**Reviewing a security-relevant change:** `architecture/security-model.md` →
`privacy/data-map.md` → the negative-path helper set in
`apps/api/test/support/negative-paths.ts`.

## Where these disagree

`FOUNDATION.md` is the record of what was decided and when. If one of the
expanded documents contradicts it, the expanded document is out of date — fix
it rather than working around it.
