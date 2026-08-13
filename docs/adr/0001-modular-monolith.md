# ADR-0001 · A modular monolith, not microservices

**Status:** Accepted · **Date:** 2026-07-27

## Context

The core workflow — assign a driver, transition a ride, capture a payment,
write an audit event — spans four domains **inside one transaction**. We have
one team, one deployment, and no independent scaling requirement.

## Decision

A single NestJS application, organised into modules with real boundaries.

Modules communicate through **injected services and typed events**, never by
reaching into each other's Prisma models. Each module owns its tables.

The boundary is enforced by lint, not by memory
(`packages/eslint-config/boundaries.js`):

- A module may not deep-import a sibling's `data/` layer or its DTOs.
- `modules/` may import a *port* but never a concrete adapter.
- `src/domain/` may import neither Nest nor Prisma — that is what makes the
  state machines exhaustively testable.

## Alternatives

**Microservices from the start.** Distributed across services, the core
workflow becomes a saga with compensating actions — for zero present benefit,
and at the cost of every local invariant becoming an eventual-consistency
problem. Rejected.

**A monolith with no internal boundaries.** Cheaper today; the erosion is not a
big architectural decision but one service quietly importing another module's
repository because the data was right there. By the time extraction is needed,
it is a rewrite. Rejected.

## Consequences

- One deployment unit, one database, real transactions across domains.
- The monolith is kept **extractable**. When ride volume or team topology
  justifies it, `tracking` extracts first: highest write volume, lowest
  consistency requirement, and it already talks to the rest of the system
  through the queue and the ports.
- Boundary violations are caught in CI rather than in review.

## Revisit when

- A single module's scaling profile diverges enough that it needs its own
  deploy cadence — `tracking` is the candidate.
- A second team owns a module and the deploy coupling is measurably slowing
  both.
- Not before either of those is *demonstrated*.
