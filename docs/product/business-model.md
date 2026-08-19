# Business model

## Who pays

**Two payers, one mechanism.** This is the decision the rest of the document
hangs off, and it changed: the model was originally one payer — a family, who
paid a flat fee *and* the fare for each ride, with our margin taken as a
percentage of that fare.

That model had a structural problem. It made our revenue rise exactly when a
transport operator's margin was thinnest, and it gave the operator a reason to
route their busiest days around us. The operator was also the party whose
adoption decided whether the product existed at all — dispatchers are who we
sell to (see below) — and they were the one party we had no commercial
relationship with.

So both sides now subscribe:

| | Family | Dispatch operator |
| - | ------ | ----------------- |
| **What they buy** | Coordination: booking, live tracking, reminders, the care circle | Operations: dispatch console, driver app, assignment |
| **Priced by** | Household | **Drivers on the road** |
| **Cadence** | Monthly or annual | Monthly or annual |
| **Also pays** | The fare for each ride | — |

Both are `SubscriptionPlan` rows with entitlements, resolved server-side (B1).
Neither is a constant in code.

### Why per-driver for the operator

It is the only number an operator already tracks, and the only one that moves
with the value they get from us. Per-ride platform pricing was the alternative
and it is worse for both sides, for the reasons above. Per-dispatcher-seat was
also considered and rejected: a company with three dispatchers and forty
drivers gets forty drivers' worth of value.

The ladder is **graduated** — the first five drivers are included in the base
price, six to twenty are priced in one band, twenty-one and above in another —
so an operator's bill never *falls* when they hire. Volume pricing, where the
whole fleet re-prices at the rate the total reaches, produces exactly that, and
explaining it ends in a spreadsheet nobody trusts again.

### Why annual is a row, not a discount

The annual plan is a separate `SubscriptionPlan` record with its own price, not
`monthly × 12 × 0.83` computed somewhere. The size of the annual discount is a
commercial decision that must be changeable without a deploy, and a multiplier
hides where the rounding happened.

### The fare, and who takes a cut of it

The family still pays for each ride. What changed is where our margin comes
from:

- **Operator on a subscription** → the whole fare passes through to them. Our
  margin is their seats, taken a month earlier. Charging a percentage as well
  would be charging twice for one relationship, which an operator finds in a
  spreadsheet six months in and never forgives.
- **Operator not on a subscription** → the pricing rule's `platformFeeBps`
  applies. This exists so a pilot operator can be onboarded before they have
  signed anything, not as a second revenue line.

Which branch a ride landed on is stamped on the ride alongside the pricing rule
version, so a payout can be explained months later. `settleFare` in
`apps/api/src/domain/pricing.ts` is the whole of it, and it is decided at
**driver assignment** — the family is quoted a total before anybody has been
dispatched, and which operator carries them decides the split, not the price.

The family pays the same total either way. This is deliberate: a price that
moved with our commercial arrangements would be a price the family could not
predict.

## What happens when a payment fails

A failed payment moves a subscription to `pastDue` and it **keeps entitling**
for the plan's grace window — seven days for a family, fourteen for an
operator.

That is not generosity. The naive implementation cuts live tracking off the
instant a card expires, and the family's first signal that a renewal failed is
a blank map while their mother is in a stranger's car. Cards expire; that
happens to everybody, and disproportionately to the adult children managing an
ageing parent's logistics between other obligations. Dunning happens by email,
in the surface built for it. The operator window is longer because losing the
console mid-shift strands passengers who are already booked, and an accounts
department does not turn a failed card around in seven days.

Cancelling is not a refund and not an immediate switch-off: a subscription
moves to `pendingCancellation` and runs to the end of the period already paid
for.

## Seat changes, mid-period

Adding a driver is charged immediately, prorated for the remainder of the
period. Removing one takes effect at the next renewal and is not refunded — the
seat stays usable until the period that paid for it ends.

The asymmetry is stated on the pricing page rather than discovered on an
invoice. What it removes is the option to churn seats daily around a renewal
date; what it costs an operator who genuinely shrinks is at most one period.

Every change is written to an append-only `SeatLedgerEntry`. Without it, "why
were we billed for eleven drivers in June" is answerable only from a driver
table that has since changed.

## Cost structure

| Line | Driver | Control |
| ---- | ------ | ------- |
| Transport fulfilment | Partner providers (B2) — we own no vehicles and employ no drivers in the MVP | Contractual |
| Map and routing | Scales with **tracked rides**, not with users | Behind an interface (T6); ETA throttled and cached; cost alarm from Stage 3. Risk R4 |
| Infrastructure | Roughly flat at pilot scale (T3: under ~500 rides/day, one API instance plus Redis) | No AWS service enters without a stated need |
| Payments | Stripe percentage, on both payers | — |
| Support | Human inbox (O4), business hours (O5) | Every avoided dispatch call is the product working |

## Who pays, who benefits

The family member pays for coordination. The patient benefits. The operator
pays for the tools their dispatcher and drivers use, and the driver supplies
the data that makes the family's side worth paying for.

A pricing or product decision that improves one at the cost of another breaks
the loop — the clearest example being battery drain on the driver app, which is
a *revenue* risk on both lines now and not merely a technical one (R2).

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

Under the previous model that sentence described a risk we had no instrument
for. It now describes a contract.

## What would change the model

- A pilot showing families will not pay a subscription but will pay a per-ride
  premium → collapse the family line to one, and lean harder on seats.
- An operator refusing per-driver pricing → the ladder becomes per-dispatcher
  or per-vehicle. The mechanism does not change; `SeatTier` rows do.
- Operators subscribing but families not → the buyer changes, and the ops
  console becomes the product surface that matters most.
- Medicaid brokerage access → the constraint in B3 lifts and the addressable
  market changes shape entirely.

All are measured in the pilot rather than guessed at now. See
[success-metrics.md](success-metrics.md) and
[ADR-0011](../adr/0011-two-sided-subscription-billing.md).
