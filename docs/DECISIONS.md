# Decision log

Short records of choices that would otherwise be re-litigated. Newest last.

---

## 1. Do not collect full date of birth

**Date:** Phase 1 · **Status:** Accepted · **Applies to:** `senior_profiles`

### Decision

The MVP does **not** store a senior's full date of birth. If a coarse age
signal is ever genuinely needed for mobility planning, an optional `age_band`
enum (`under_65`, `65_74`, `75_84`, `85_plus`) is added instead.

### Why

Full date of birth is one of the strongest re-identification keys in existence.
Combined with a name and a ZIP code — both of which we hold — it identifies a
specific individual with high confidence, and it is the same triple used for
identity verification by banks, clinics, and government services. Holding it
raises the value of a breach substantially.

Against that, we asked what the MVP actually *does* with it, task by task:

| Task                                     | Needs DOB? | What it actually needs             |
| ---------------------------------------- | ---------- | ---------------------------------- |
| Arranging a ride                          | No         | Address, phone, mobility needs      |
| Choosing an accessible vehicle            | No         | The accessibility requirement itself |
| Assigning a companion                     | No         | Availability and location            |
| Caregiver identifying the right person    | No         | Preferred name, address, phone       |
| Clinic check-in                           | No         | The clinic verifies identity itself  |
| Age-eligibility for the service           | No         | Not gated on a numeric age in the MVP |

Nothing in the workflow needs it. The clinic already verifies identity; we are
arranging a car and a companion, not admitting anyone to a hospital.

### Consequences

- Lower breach impact, and one less field to protect, audit and retain.
- If a transport provider later requires date of birth to match a booking,
  that is a new, narrower decision: it can be collected per-request at the
  point of need rather than stored on the profile indefinitely.
- `dob`, `dateOfBirth` and `birthdate` are on the logger's redaction denylist
  regardless, so a later addition cannot silently start appearing in logs.

### Alternatives considered

- **Store DOB "in case we need it later"** — rejected. Speculative collection is
  the exact habit that makes breaches worse, and it is hard to walk back once
  it is in the schema and in backups.
- **Store year of birth only** — rejected in favour of an age band, which is
  coarser and equally useful for the one plausible use case.

---

## 2. Legal name is optional, preferred name is not

**Date:** Phase 1 · **Status:** Accepted

Preferred name is required — someone must be greeted by the name they use.
Legal name is optional and collected only when a transport provider or clinic
requires it to match their records. The two are separate fields rather than one
"name" field, so the operational need does not force everyone to hand over a
legal name.

---

## 3. Content-Security-Policy waits for middleware

**Date:** Phase 1 · **Status:** Accepted · **Revisit:** Phase 2

Static security headers ship in Phase 1 via `next.config.ts`. CSP does not,
because a useful CSP for Next.js needs a per-request nonce, and that requires
middleware. Middleware arrives in Phase 2 for Supabase session handling, so CSP
is added there — one place owning all request-scoped headers, rather than a
weak CSP now and a rewrite later.

Tracked in [SECURITY.md](../SECURITY.md) → Known gaps.

---

## 4. Sentry is a seam, not a dependency, until Phase 7

**Date:** Phase 1 · **Status:** Accepted · **Revisit:** Phase 7

`src/lib/observability/error-reporter.ts` is the single call site for error
reporting. The Sentry SDK is not installed yet: with no DSN configured it would
send nothing, while adding build weight and a second redaction surface to
audit. Phase 7 replaces the function body; no call site changes.

Errors are never dropped in the meantime — they go to the redacting server log.

---

## 5. Notifications carry no detail

**Date:** Phase 1 · **Status:** Accepted

SMS and email say that something changed and ask the recipient to sign in. No
appointment time, clinic name, address, or senior's name.

The reason is not only regulatory. A phone on a kitchen table is readable by
whoever is in the room, and for an older adult that may include the person they
most need privacy from. Contentless notifications also mean a compromised email
account yields nothing.

---

## 6. Component scale raised above the shadcn/ui default

**Date:** Phase 1 · **Status:** Accepted

The default control height in the chosen shadcn/ui preset is 32–36px. Buttons
were rescaled so the default is 44px, matching WCAG 2.5.5 target-size guidance,
with body-sized label text and a 17px root font size.

Users are adult children coordinating care under stress, often one-handed on a
phone, and caregivers tapping check-in outside in the cold. Small controls are
a real failure mode here, not a stylistic preference.
