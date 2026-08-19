# ADR-0011 · Both sides subscribe; drivers are the operator's meter

**Status:** Accepted · **Date:** 2026-08-19 · **Implemented:** the model and the
API in this change; the money movement in Stage 4

## Context

CareBridge had one payer. A family paid a flat subscription **and** the fare for
each ride, and our margin was a percentage of that fare. The transport operator
— whose dispatcher decides whether the company renews, and whose drivers
produce the data the family's side is worth paying for — had no commercial
relationship with us at all. The word "organisation" appeared in the
authorisation model and nowhere in the schema.

Three problems with that, in order of seriousness:

1. **The revenue was counter-cyclical to the operator.** A percentage of every
   fare rises exactly when their margin is thinnest, and gives them a standing
   reason to route their busiest days around us.
2. **We could not sell to the party we were selling to.** The sales motion is
   "your customers stop calling your dispatch line". That is a pitch to an
   operator, and we had nothing to charge them for.
3. **A family paying a subscription and a fare could not be told what the
   subscription was for**, because part of the answer was "a cut of the fare".

## Decision

**Two payers, one mechanism.** A `BillingAccount` belongs to either a household
(a `User`) or a `dispatchOrganization` (an `Organization`), and holds at most
one live `Subscription`. Both sides choose **monthly or annual**.

- **Family** — flat price per interval.
- **Dispatch operator** — base price plus a **graduated per-driver ladder**.
  A driver occupies a seat exactly while their status is `approved` — one
  definition, `occupiesSeat` — and every change is written to an append-only
  `SeatLedgerEntry`.

**The fare is settled once, at driver assignment**, by `settleFare`. If the
operator holds an entitling subscription, the platform fee is zero and the
whole fare passes to them; otherwise the pricing rule's `platformFeeBps`
applies. Which branch was taken is stamped on the ride beside the pricing rule
version, so a payout is explicable months later.

## The five properties that matter

**One mechanism, not two.** A `FamilyBillingService` beside an
`OperatorBillingService` ends with two answers to "is this entitling right
now", and the disagreement is either a family locked out of a live trip or an
operator using a console they stopped paying for.

**Plans are rows, versioned.** `SubscriptionPlan.version` is copied onto every
`SubscriptionPeriod` it bills, exactly as `PricingRule.version` is copied onto
every ride. Annual is a separate row rather than a multiplier in code.

**Graduated, not volume.** Each driver is priced in the band they fall in.
Volume pricing — the whole fleet at the rate the total reaches — makes an
operator's invoice *fall* when they hire.

**A failed payment keeps entitling, for a bounded window.** Seven days for a
family, fourteen for an operator, both on the plan row. The alternative blanks
the map mid-trip and tells a family about a declined card by frightening them.

**Never charge twice for one relationship.** An operator paying by seats keeps
the whole fare. This is the single rule the whole ADR exists to encode.

## Alternatives

**Keep the per-ride margin and add operator seats.** Simplest to implement, and
it is the double charge above. Rejected.

**Price the operator per dispatcher seat.** Fewer seats, cleaner analogy to
other SaaS. Rejected: a company with three dispatchers and forty drivers gets
forty drivers' worth of value, and the meter would not move with it.

**Price the operator per completed ride.** Same counter-cyclicality as before,
one level up. Rejected.

**Peak seats within the period as the billed quantity.** Closes the "hire for
the busy week, fire before renewal" gap more tightly, but an invoice line
reading "your peak was 14 on the 9th" is one nobody can check against their own
records. Rejected as the *quantity*, and kept as the **proration floor**:
`Subscription.seatsPaidFor` is the high-water mark for the current period, and
proration is measured against it. An operator who drops from twelve drivers to
ten and back to twelve inside one month has already paid for twelve, and
charging again on the way back up would bill the same seats twice — precisely
to the operator whose staffing is least stable.

**Annual as a computed discount.** Fewer rows. It puts a commercial decision in
a deploy and hides the rounding. Rejected.

## Consequences

- `Organization` and `OrganizationMembership` exist now rather than at Stage 5E,
  which closes a documented gap: `docs/architecture/multi-tenancy.md` described
  `OrganizationMembership` as built when no such table existed.
- Every driver belongs to an operator. The migration backfills the pilot
  operator onto existing drivers and vehicles, then tightens the column.
- The driver lifecycle became load-bearing for billing, which is why
  `DriverStatus` arrived with the first slice of Stage 3 rather than as a
  separate concern: a seat has to be granted and released by *something*, and
  a boolean beside the status would have been a second answer to the same
  question.
- Registration starts a household trial. A family that never sees a plan, a
  renewal date or a price cannot find out what this costs until the day it
  stops working.
- Ride creation now checks an entitlement as well as a patient grant. They are
  different questions, and collapsing them would make a lapsed plan read as
  "you are not family".
- **No money moves yet.** Quotes are computed, recorded and stamped with the
  plan version that produced them; handing the amounts to Stripe is Stage 4 and
  [ADR-0006](0006-stripe-payments.md). The seam is `SubscriptionPeriod` — an
  unpaid period is a period with no payment against it, not a missing row.
- Stripe now has two customer types. It receives a name, an email and an
  amount for a family, and a company name and an amount for an operator; it
  remains outside the PHI boundary (L3).

## Revisit when

The pilot produces evidence on either line: families declining the subscription
but accepting a per-ride premium, or an operator refusing per-driver pricing.
Either changes the *shape* of a plan row, which is a seed change; only both
changing at once would supersede this ADR.

Also revisit if a second operator in the same metro area starts carrying the
same patients — the first case where a ride's `settledOrganizationId` and a
family's expectations can diverge.
