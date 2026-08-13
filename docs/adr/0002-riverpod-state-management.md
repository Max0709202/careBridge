# ADR-0002 · Riverpod, not Bloc

**Status:** Accepted · **Date:** 2026-07-27

## Context

Three Flutter surfaces share one client layer. The hardest state in the product
is "live driver position, may be stale, may be reconnecting" — a stream with
freshness semantics, not a sequence of discrete events.

## Decision

**Riverpod**, applied everywhere. `StreamProvider` and `AsyncNotifier` are the
primitives for live state.

## Alternatives

**Bloc.** Its advantage is a rigid, auditable event log. That matters less here
than it usually would, because the **server** owns the ride state machine and
already emits an audit trail — so Bloc's event log would be a second,
client-side, non-authoritative copy of something we already have durably.

Against it: substantially more boilerplate for the same behaviour, and
event/state pairs model "a stream that may be stale" far less directly than
`AsyncValue` does.

**`provider` alone.** No compile-time safety on dependencies, and no good
answer for scoped overrides in tests.

**`setState` and friends.** Not viable across three surfaces.

## Consequences

- Compile-time-safe dependency injection; a missing dependency is a build
  error rather than a runtime null.
- `ProviderContainer` overrides make widget tests trivial — the fake API client
  is a one-line override rather than a mocking framework.
- `AsyncValue` models loading, data and error as one type, which is what stops
  the "loading spinner that never ends" class of bug.
- One choice, applied everywhere. A codebase with two state-management
  approaches has three.

## Revisit when

Never, casually. Changing this is a rewrite of every screen. The only genuine
trigger would be Riverpod becoming unmaintained.
