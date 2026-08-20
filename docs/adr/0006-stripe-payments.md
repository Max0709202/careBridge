# ADR-0006 · Stripe, with card data never touching us

**Status:** Accepted · **Date:** 2026-07-27 · **Implemented:** Stage 4 (partly —
see *Where this stands* below)

## Context

Families pay by card (B3). We need saved payment methods, authorisation at
assignment, capture at completion, refunds, and subscriptions — while keeping
our PCI scope as small as it can be, and keeping payment data out of the
health-adjacent boundary entirely.

Since [ADR-0011](0011-two-sided-subscription-billing.md) there are **two**
paying parties: a household and a transport operator. Both hold a
`BillingAccount`, and `externalCustomerId` on that row is where the Stripe
customer id lives for either. The flows below are unchanged for the family's
per-ride charges; the operator's subscription is an ordinary recurring charge
with a seat-derived amount, and the amount is quoted by our own domain code
before it reaches Stripe.

## Decision

**Stripe**, using the SDK's PaymentSheet in both apps. Card data never touches
our servers or our database; we store only Stripe customer and payment-method
identifiers.

The flow:

1. A `Customer` on first payment setup — per `BillingAccount`, so a household
   and an operator are separate customers even where one person administers
   both.
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
  and amount for a family, a company name and amount for an operator, and no
  health or ride detail in either case (L3).
- An operator's invoice amount is derived from `SeatLedgerEntry` and the plan's
  tiers, and stored on a `SubscriptionPeriod` **before** it is charged. Stripe
  is told a number; our ledger is what explains it.
- Test mode throughout development, with the same code path — not a stubbed
  alternative that diverges.

## Revisit when

Insurance or Medicaid billing enters scope (a Stage 5 decision), at which point
the payment model changes shape entirely and this ADR is superseded rather than
amended.

## Where this stands

The **port** is `infrastructure/payments/payments.port.ts` and there are two
adapters behind it, chosen by `PAYMENTS_DRIVER`.

`StripePaymentsAdapter` speaks the REST API directly rather than through the
`stripe` package — the same call the push adapter makes about `firebase-admin`,
and for the same reason: this system touches a customer, a payment method, a
payment intent and a refund, which is two hundred lines we can read against a
dependency tree we cannot. It is written and typed; it has **not** been
exercised against a live Stripe account, and that is the remaining work.

`LocalPaymentsAdapter` moves no money and decides each outcome from the card's
last four digits, using Stripe's own test-card meanings — `4242` settles,
`9995` is declined for insufficient funds, `9979` is reported stolen. That
correspondence is the point rather than a convenience: a developer reproducing
a customer's dunning sequence locally uses the card number from the ticket, and
the whole unhappy path is reachable with no account at all. Config validation
refuses it in production, which is the most consequential of those refusals —
an adapter that reports every charge as settled is a system that bills nobody
and says everything is fine.

Two decisions in the implementation are worth recording here because they are
not obvious from the flow above.

**A charge is not transactional with the row that records it.** Collection is
three commits: the attempt is claimed on the invoice, the `Payment` row is
written *before* the processor is called, and the outcome is recorded after.
The single-transaction version can roll back after Stripe has taken the money,
and the next sweep — finding no record — charges again. The payment row's id
seeds the `Idempotency-Key`, so a retry of a lost response is answered from
Stripe's record rather than performed.

**A timeout is not a decline.** The port models `pending` as a first-class
outcome alongside success and failure, and a transport failure leaves the
payment there rather than reporting it as failed. Treating "we do not know" as
"it did not work" retries a charge that may already have succeeded; the webhook
settles it instead.

What is **not** built: initiating a refund. The port and both adapters support
it and a refund issued in Stripe's own console is reconciled against its invoice
through `charge.refunded`, but there is no endpoint to start one — a refund
button with no approval surface behind it is worse than no button. It belongs
with the administration surfaces, which are the rest of this stage.
