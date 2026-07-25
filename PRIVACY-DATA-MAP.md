# PRIVACY-DATA-MAP.md

Every category of personal data CareBridge intends to hold, why it is needed,
who can see it, and how long it is kept.

**Rule: a field does not get added until it has a row in this table.** If you
cannot write a one-line justification tied to an actual operational task, the
field does not go in.

> Status: Phase 1. The schema is not built yet (Phase 2). This document is the
> specification the schema must satisfy, written first on purpose.

---

## What we do not collect

Stated first, because it is the most important control we have:

- ❌ Diagnoses, symptoms, conditions, or any clinical history
- ❌ Medication names, dosages, or schedules
- ❌ Insurance identifiers, claims, or eligibility data
- ❌ Records from any EHR/EMR system
- ❌ Continuous location or GPS traces
- ❌ Full date of birth (see [docs/DECISIONS.md](docs/DECISIONS.md) #1)
- ❌ Payment card numbers (handled entirely by Stripe)
- ❌ Social Security numbers or government identifiers

The reason a coordinator needs a wheelchair-accessible vehicle is not our
business. *That* one is required is.

---

## Data categories

Sensitivity: **Low** (operational) · **Medium** (identifying) · **High**
(identifying + reveals vulnerability or location).

### Account and identity

| Field                | Why                                | Sensitivity | Who can see it                      | Retention              |
| -------------------- | ---------------------------------- | ----------- | ----------------------------------- | ---------------------- |
| User id (UUID)       | Primary key, audit actor           | Low         | System, operations                  | Life of account        |
| Email address        | Sign-in, notifications             | Medium      | Self, operations                    | Life of account        |
| Role                 | Authorization                      | Low         | Self, operations                    | Life of account        |
| Family account id    | Scopes all family data             | Low         | Family members, operations          | Life of account        |

### Senior profile — the most sensitive record in the system

| Field                        | Why                                                              | Sensitivity | Who can see it                          | Retention        |
| ---------------------------- | ---------------------------------------------------------------- | ----------- | --------------------------------------- | ---------------- |
| Preferred name               | Addressing someone by the name they use is the baseline of respect | Medium    | Own family, operations, assigned caregiver | Life of profile |
| Legal name (optional)        | Only when a clinic or transport provider requires it to match records | Medium | Own family, operations                  | Life of profile  |
| Age band (optional)          | Coarse mobility planning. **Not** full date of birth              | Low         | Own family, operations                  | Life of profile  |
| Telephone number             | Driver and coordinator need to reach them on the day             | High        | Own family, operations, assigned caregiver on the day | Life of profile |
| Address                      | Pickup and drop-off                                              | High        | Own family, operations, assigned caregiver on the day | Life of profile |
| Mobility / accessibility needs | Determines vehicle type and physical assistance                | High        | Own family, operations, assigned caregiver | Life of profile |
| Emergency contact name + phone | Someone to call if something goes wrong                        | High        | Own family, operations, assigned caregiver on the day | Life of profile |
| Coordination notes           | Free text from the family, e.g. "ring the bell twice"            | High        | Own family, operations, assigned caregiver | Life of profile  |
| Consent status               | Records that the family confirmed authority to share             | Medium      | Own family, operations                  | Longer than profile |

> **Free-text risk.** Coordination notes are free text, so a family may type
> something clinical into them despite the field's guidance. Mitigations: the
> field label and helper text state what it is for; the value is never logged
> (`notes` is a redacted key); access follows the same rules as the rest of the
> profile. This residual risk is accepted for the MVP and re-examined in Phase 7.

### Service request

| Field                       | Why                                        | Sensitivity | Who can see it                         | Retention             |
| --------------------------- | ------------------------------------------ | ----------- | -------------------------------------- | --------------------- |
| Appointment date/time (UTC) | The whole point of the request             | High        | Own family, operations, assigned caregiver | Service record period |
| IANA time zone              | Correct display at the service location    | Low         | Same                                   | Same                  |
| Clinic name and address     | Destination                                | High        | Own family, operations, assigned caregiver | Same                  |
| Transportation required     | What to arrange                            | Low         | Same                                   | Same                  |
| Wheelchair / accessibility  | Vehicle selection                          | Medium      | Same                                   | Same                  |
| Companion required          | Whether to assign a caregiver              | Low         | Same                                   | Same                  |
| Status                      | Coordination state                         | Low         | Same                                   | Same                  |

> Clinic name can imply a medical specialty, and therefore a condition. It is
> operationally unavoidable — a driver must know where to go — so it is treated
> as high sensitivity, never logged, and never included in notifications.

### Assignment and service delivery

| Field                     | Why                         | Sensitivity | Who can see it                       | Retention             |
| ------------------------- | --------------------------- | ----------- | ------------------------------------ | --------------------- |
| Caregiver profile         | Who can be assigned         | Medium      | Self, operations                     | Life of account       |
| Availability windows      | Manual assignment           | Low         | Self, operations                     | Life of account       |
| Assignment + status       | Coordination                | Medium      | Own family, operations, that caregiver | Service record period |
| Check-in / check-out times| Proof of service            | Medium      | Own family, operations, that caregiver | Service record period |
| Incident reports          | Safety                      | High        | Operations, reporting caregiver      | Longer than the request |
| Internal operations notes | Coordination between staff  | High        | **Operations only** — never caregivers, never families | Service record period |

### Payments

| Field                    | Why                     | Sensitivity | Who can see it     | Retention        |
| ------------------------ | ----------------------- | ----------- | ------------------ | ---------------- |
| Stripe customer/session id | Reconciliation        | Low         | Operations         | Financial period |
| Payment state and amount | Billing                 | Low         | Own family, operations | Financial period |
| Card details             | **Never stored**        | —           | —                  | —                |

### Audit and notifications

| Field                                  | Why                          | Sensitivity | Who can see it | Retention                  |
| -------------------------------------- | ---------------------------- | ----------- | -------------- | -------------------------- |
| Audit: actor id, action, entity type, entity id, timestamp, safe metadata | Accountability | Medium | Operations | Longer than the records it describes |
| Notification: type, recipient id, channel, delivery state | Debugging delivery | Low | Operations | Short |

> **Audit events store references, not contents.** An audit row says *"actor X
> changed request Y from CONFIRMED to CAREGIVER_ASSIGNED at T"*. It never
> contains the address, the notes, or the clinic. Otherwise the audit log
> becomes a second, less protected copy of the sensitive data.
>
> **Notification records store no message body**, because bodies are
> deliberately contentless — see below.

---

## Notification content policy

SMS and email say **that** something changed and ask the recipient to sign in.
They never contain the appointment time, clinic name, address, senior's name,
or any health-adjacent detail.

A phone screen on a kitchen table is not a private place, and email is not an
authenticated channel.

---

## Access summary

| Role                | Can see                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| **Family**          | Only seniors, requests and assignments within their own family account   |
| **Caregiver**       | Only assignments offered to or accepted by them, and only the details needed to perform them. **Never internal operations notes.** |
| **Operations admin**| All requests and assignments, for coordination. Sensitive access is audited. |

Enforced server-side in `server/authz`, with PostgreSQL Row Level Security as
defence in depth. Full matrix: [docs/AUTHORIZATION-MATRIX.md](docs/AUTHORIZATION-MATRIX.md).

---

## Open items before launch

- Retention periods are placeholders and need a legal decision, not an
  engineering one
- Data subject access and deletion process (including US state privacy law)
- Vendor list and data processing agreements (Supabase, Stripe, Twilio, Resend)
- Whether any part of this falls in scope of HIPAA or state health privacy law
- Backup encryption, retention, and restore testing
- Consent wording, and how consent is evidenced and withdrawn
