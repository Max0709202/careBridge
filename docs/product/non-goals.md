# Non-goals

Each of these is a decision, not an omission. They are listed so that a future
"why don't we just…" has an answer with a reason attached.

## CareBridge is not

- **an EHR.** No diagnoses, medications, clinical notes or lab results. Ever,
  in the MVP. Appointment "type" is a coarse coordination label — *specialist
  visit* — and never a condition.
- **a diagnosis or triage system.** No symptom checkers, no advice.
- **an emergency service.** Not a 911 replacement, and nothing in the product
  may imply it could be used as one.
- **clinical decision support.** No recommendations that touch care.
- **a medication management system.**
- **a medical device.** Nothing here is regulated as one, and no feature will
  be added that would make it one without that being an explicit, planned
  decision.

## Deliberately absent from the data model

- **No date of birth.** Name + address + DOB is the classic re-identification
  triple and the standard identity-verification set. Nothing in arranging a car
  needs it. An optional coarse `age_band` covers genuine mobility planning. If
  a provider later requires a full DOB for a records match, it is collected
  per-request at the point of need, never stored on the profile.
- **Legal name optional.** Preferred name is required — someone must be greeted
  by the name they use. Only an operational records-match justifies a legal
  name.
- **No clinical free text.** Mobility requirements are operational
  ("wheelchair, transfer assistance, escort to door"), not diagnostic.

## Not built, on purpose

- **No web portal for families in the MVP** (D2). Family and patient value is
  realised on a phone. Web returns for the internal ops console. Tracked as
  risk R5; if a pilot shows a family segment that will not install an app,
  Next.js against the same `/api/v1` contract is the unblocked path.
- **No insurance, Medicaid or Medicare billing** (B3). Families pay by card.
  This is the single largest constraint on early market size and it is accepted
  knowingly.
- **No automated background checks presented as verification.** Driver
  onboarding happens off-platform (O3). We record status and documents; we do
  not verify, and we will not describe ourselves as if we do.
- **No microservices** until an actual scaling, ownership or deployment need is
  demonstrated. See [../adr/0001-modular-monolith.md](../adr/0001-modular-monolith.md).
- **No blockchain.**

## The AI rules (Stage 5C, if it happens at all)

The coordination assistant is **logistics and communication only**. The
following are hard rules, not guidelines:

- No diagnosis. No treatment advice. No emergency claims.
- **Human confirmation for anything that books or charges.**
- Every AI-initiated action audited, with the model version recorded.
- Minimum necessary data sent to any vendor.
- Prompt-injection defences on any connected content.
- A signed vendor BAA before any real data flows.

## The compliance rule

We describe the system as **"HIPAA-ready architecture"** and never as "HIPAA
compliant". Compliance requires a legal determination of our role, executed
BAAs, documented administrative and physical safeguards, workforce training,
access reviews and an incident-response process — none of which are properties
of source code. CI enforces this: a pull request that adds the phrase fails.
