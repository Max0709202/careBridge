# ADR-0006 · Stripe, with card data never touching us

**Status:** Accepted · **Date:** 2026-07-27 · **Implemented:** Stage 4

## Context

Families pay by card (B3). We need saved payment methods, authorisation at
assignment, capture at completion, refunds, and subscriptions — while keeping
our PCI scope as small as it can be, and keeping payment data out of the
health-adjacent boundary entirely.

## Decision

**Stripe**, using the SDK's PaymentSheet in both apps. Card data never touches
our servers or our database; we store only Stripe customer and payment-method
identifiers.

The flow:

1. A `Customer` on first payment setup.
2. A `SetupIntent` saves a card.
3. On **driver assignment**, a `PaymentIntent` with `capture_method: manual`
   authorises the estimated fare.
4. On **ride completion**, the intent is captured for the final amount. A
   capture may be lower than the authorisation; a materially higher final fare
   requires a new intent.
5. On cancellation the authorisation is released, subject to the cancellation
   policy.

## The three properties that matter

**Idempotency.** Every mutating call carries a key derived from our own entity
ids — not a random value, so a retry of the *same* logical operation reuses it.

**Webhook integrity.** Signatures verified against the signing secret **before
parsing**. Events recorded in `webhook_events` keyed by the Stripe event id;
the unique constraint is what makes replay a no-op. Processing happens
asynchronously from a queue, so a slow handler cannot cause Stripe to retry.

**Our ledger is authoritative** for internal state. A nightly reconciliation
job compares it to Stripe and alerts on drift. Without that, "what do we
believe we are owed" and "what did the processor do" diverge silently and are
discovered by an accountant months later.

## Alternatives

**Direct card handling.** PCI DSS Level 1 scope. Not a serious option.

**Braintree / Adyen.** Comparable capability; Stripe's test-mode fidelity and
Flutter SDK are better, and the SDK quality matters because PaymentSheet is
what keeps us at SAQ-A.

**Authorise at completion instead of assignment.** Simpler, and it means
discovering a declined card *after* a vulnerable person has already been driven
somewhere. Rejected.

## Consequences

- PCI SAQ-A via the SDK.
- Stripe is **deliberately excluded from PHI scope**: it receives name, email
  and amount, and no health or ride detail (L3).
- Test mode throughout development, with the same code path — not a stubbed
  alternative that diverges.

## Revisit when

Insurance or Medicaid billing enters scope (a Stage 5 decision), at which point
the payment model changes shape entirely and this ADR is superseded rather than
amended.
