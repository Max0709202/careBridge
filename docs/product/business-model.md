# Business model

## Revenue

Two lines, and both are **configurable records, never constants in code** (B1):

1. **Family subscription.** Recurring, per household. Plans, trial, upgrade,
   downgrade and cancellation are all data — a `SubscriptionPlan` row with
   entitlements, resolved server-side.
2. **Per-ride margin.** Distance-and-time based with accessibility and
   wait-time surcharges (B4), computed from a versioned `PricingRule`.

The `PricingRule.version` is stored on every ride's estimate. That is the
mechanism by which a charge from eight months ago can still be explained to the
person who paid it — which is a support requirement before it is an accounting
one.

## Cost structure

| Line | Driver | Control |
| ---- | ------ | ------- |
| Transport fulfilment | Partner providers (B2) — we own no vehicles and employ no drivers in the MVP | Contractual |
| Map and routing | Scales with **tracked rides**, not with users | Behind an interface (T6); ETA throttled and cached; cost alarm from Stage 3. Risk R4 |
| Infrastructure | Roughly flat at pilot scale (T3: under ~500 rides/day, one API instance plus Redis) | No AWS service enters without a stated need |
| Payments | Stripe percentage | — |
| Support | Human inbox (O4), business hours (O5) | Every avoided dispatch call is the product working |

## Who pays, who benefits

The family member pays. The patient benefits. The driver supplies the data that
makes the thing worth paying for. A pricing or product decision that improves
one at the cost of another breaks the loop — the clearest example being battery
drain on the driver app, which is a *revenue* risk and not merely a technical
one (R2).

## The market constraint we accepted

**Card-only.** No insurance or Medicaid billing (B3). This narrows the
addressable market substantially — a large share of NEMT volume is
Medicaid-funded — and it is accepted for the pilot because building payer
integration before proving the coordination value would be building the hard
part first for a product nobody has yet said they want.

Revisited as a Stage 5 decision, with pilot evidence. Tracked as risk R7.

## The operator relationship

Transport companies adopt CareBridge because *their* customers stop calling
their dispatch line — not because they wanted new software. That is the sales
motion, and it is why the ops console being genuinely good matters
commercially: the dispatcher is the person who decides whether the operator
renews.

## What would change the model

- A pilot showing families will not pay a subscription but will pay a
  per-ride premium → collapse to one line.
- An operator willing to pay per seat → the buyer changes, and the ops console
  becomes the product surface that matters most.
- Medicaid brokerage access → the constraint in B3 lifts and the addressable
  market changes shape entirely.

All three are measured in the pilot rather than guessed at now. See
[success-metrics.md](success-metrics.md).
