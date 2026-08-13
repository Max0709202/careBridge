# Vision

> One place to arrange an elderly relative's appointment and the ride to it —
> and live proof, minute by minute, that it is actually happening.

## The wedge

Adjacent products solve fragments:

- **NEMT brokers** move people, and tell families nothing.
- **Consumer rideshare** tracks beautifully, and cannot handle a wheelchair, a
  scheduled pickup, or a passenger who needs an arm to lean on.
- **Caregiver marketplaces** staff visits, and ignore transport entirely.

The defensible position is the **join** between them, held by an audited event
timeline. Owning the appointment → ride → payment graph makes caregiver, clinic
and insurance layers natural extensions later. Starting at any of those layers
makes the coordination layer a retrofit.

## Why tracking is the product, not a feature

The live map is the only feature that converts an *administrative* product into
an *emotional* one, and emotional products retain. Concretely it does four
things a status list cannot:

- **It replaces a phone call.** Every avoided call to dispatch is a cost saved
  on both sides of the transaction.
- **It bounds anxiety.** "Driver is 6 minutes away" is a finite, tolerable
  wait. "No update since 09:12" is not.
- **It produces evidence.** No-show disputes, late-pickup complaints and refund
  requests are all resolved by the same event log — which is also the audit
  trail a regulator or an enterprise customer will ask to see.
- **It is the wedge into the operator.** Transport companies adopt CareBridge
  because *their* customers stop calling them, not because they wanted new
  software.

## The commitment that shapes everything

**Tracking must be honest.**

A stale position rendered as a confident moving car is worse than no map at
all, because it manufactures false certainty about a vulnerable person. So:

- Every location surface carries a freshness age.
- Accuracy degradation is visible, not smoothed away.
- We say "last seen 3 minutes ago" rather than interpolating a plausible lie.

This is a product decision before it is a technical one, and it is why
`capturedAt` — when the *device* took the reading — is the timestamp every
freshness label ages against.

## Why we start as coordination, not care

1. **Regulatory surface.** Coordination data (name, address, phone, appointment
   time, mobility needs) is sensitive but bounded. The moment we store
   diagnoses, medications or clinical notes we become an EHR-adjacent system,
   with the BAAs, audits and breach exposure that follow. We take that step
   deliberately and late, not by accident.
2. **The value is real without clinical data.** Nothing in any documented
   journey requires knowing *why* the patient is seeing a cardiologist.
3. **Coordination is a data-network position.** See "the wedge", above.

## What success looks like in three years

A family member who has used CareBridge for a parent's appointments does not
consider going back to phone calls, and says so to the next person in their
situation. A transport operator's dispatch line is measurably quieter. The
event timeline is the thing both parties reach for when they disagree.
