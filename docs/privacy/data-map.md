# Data map

Every category of personal data the system holds, why it is held, and what
that classification causes to happen automatically.

The controlling rule: **a field must justify itself against a task in a
documented journey before it enters the schema.**

## Classification

| Class | Meaning | Consequences |
| ----- | ------- | ------------ |
| **Highly sensitive** | Identifies a vulnerable person or their location | Redacted at the logger; never in a notification body; audited on read |
| **Sensitive** | Identifies an account holder | Redacted at the logger; audited on mutation |
| **Operational** | Needed to run a journey; not identifying on its own | Logged freely |
| **Credential** | Grants access | Never logged, never returned, stored hashed or encrypted |

## The inventory

### Patient — *highly sensitive*

| Field | Why it exists | Notes |
| ----- | ------------- | ----- |
| `preferredName` | Someone must be greeted by the name they use | Required |
| `legalName` | Records match, when a provider requires one | **Optional** |
| `phone` | The driver may need to call at the kerb | |
| `ageBand` | Coarse mobility planning | **No date of birth exists anywhere in this system** |
| `mobilityNeeds` | Vehicle and assistance matching | Operational, deliberately non-clinical |
| `mobilityNotes` | Free text a person typed about another person | Redacted at the logger |
| `homeAddress` | Pickup | Includes `accessNotes` — "gate code 4417" |

**Not held:** date of birth, diagnoses, medications, clinical notes, lab
results, insurance identifiers, government identifiers.

### Location — *highly sensitive*

| Field | Where | Lifetime |
| ----- | ----- | -------- |
| Live position | Redis `ride:{id}:location` | TTL ~2 minutes |
| Sampled history | `ride_location_samples` | **30 days**, deleted by the retention job |
| Geocoded address coordinates | `addresses` | Life of the address |

A coordinate pair is a person's position at a moment in time; in this product
it is usually a patient's, in a vehicle, mid-journey. On the redaction
denylist.

### User — *sensitive*

`email`, `fullName`, `phone`, `timeZone`, `locale`. All except `timeZone` and
`locale` are on the redaction denylist.

### Credentials — *credential*

| Item | Storage |
| ---- | ------- |
| Password | argon2id hash |
| Refresh token | SHA-256 digest |
| Verification / reset token | SHA-256 digest |
| Invitation token | SHA-256 digest |
| TOTP secret | AES-256-GCM, key in Secrets Manager |
| FCM device token | Plaintext (it is a routing address), never returned by the API |
| Web Push subscription | Plaintext JSON (endpoint and the browser's public keys — a routing address), never returned by the API |
| VAPID private key, Twilio auth token | Environment secrets only; never in the database |

### Audit — *sensitive, append-only, 7-year retention*

Actor, action, entity type and id, organisation, correlation id, IP, user
agent, and changed **field names**.

**Never values.** Knowing that a phone number was edited is what an
investigation needs; storing the old and new number would make the audit log a
second copy of the data it exists to protect.

### Messages — *highly sensitive*

`messages.body` is free text one person wrote to another about a trip — and
in this product a trip is a vulnerable person's movements. Treated like
`mobilityNotes`: on the redaction denylist, never in a notification body, never
in a push payload. Plain text only; there are no attachments to hold anything
more ([ADR-0014](../adr/0014-messaging-and-relay-calls.md)).

`senderLabel` is the name the sender was shown under when they wrote ("Sarah
(daughter)", "Marcus T."), frozen at send time; account deletion overwrites it
with "Former member" and keeps the words, because they are the other side's
record too.

Who can read a thread is derived on every request from the patient grant, the
dispatching membership and the ride's current driver — there is no stored list
of participants to fall out of date. Kept one year after the last message.

### Relay calls — *operational*

`call_sessions` records who rang whom (by **id**: a patient, user, driver or
organisation), when, the outcome and the duration. **No phone number is stored
on either side, and nothing is recorded** — numbers are resolved from the
patient, user or organisation row at dial time and passed to the telephony
provider for that call only. Kept one year.

### Billing — *sensitive*

`BillingAccount.billingEmail` and `Organization.contactEmail` are email
addresses and carry the same treatment as `User.email`: on the redaction
denylist, audited on mutation.

Everything else on the billing tables is money and counts — plan codes, period
bounds, seat totals, prorations, the invoice itemisation. None of it names a
patient, and none of it is derivable from a patient: a subscription belongs to
a *household* or an *operator*, never to the person being driven. That is not
an accident of the schema. It is what lets an invoice be emailed, exported and
handed to an accountant without any of that touching the health-adjacent
boundary.

`SeatLedgerEntry` names a **driver**, which is an employee of the operator and
not a patient. `Driver.displayName` is a first name and last initial, as it is
everywhere else.

No card number, expiry, or last-four exists in this database. Only
`externalCustomerId` — a Stripe identifier — which is why the PCI scope is
SAQ-A ([ADR-0006](../adr/0006-stripe-payments.md)).

### Operational

Appointment times, ride states, price estimates, clinic details, vehicle
details, subscription plan catalogue rows. A clinic's address and drop-off instructions reveal nothing about who
attends it, which is why clinics are shared reference data rather than patient
data.

## Vendors

| Vendor | Receives | Control |
| ------ | -------- | ------- |
| AWS | Everything | BAA required before pilot; HIPAA-eligible services only |
| Stripe | For a family: name, email, amount. For an operator: company name, contact email, amount. **No health or ride detail in either case**, and no driver names | PCI SAQ-A via the SDK; deliberately excluded from PHI scope |
| Google Maps | Address strings and coordinates | **No patient identity is ever sent** — the request carries an address and nothing else |
| FCM | Device tokens, contentless payloads | The contentless policy limits exposure |
| Browser push services (Google, Mozilla, Apple, Microsoft) | An encrypted, contentless payload per notification | RFC 8291 encryption — the push service cannot read it; the payload is contentless anyway |
| Twilio (when `TELEPHONY_DRIVER=twilio`) | The two phone numbers of a relay call, at dial time; call metadata | No recording is ever requested; no name or ride detail is sent — the call carries numbers and nothing else. BAA required before pilot |
| SES / SMTP | Email addresses, contentless bodies | BAA; contentless policy |

Three emails are the bounded exception to "contentless": verification, password
reset and invitation carry a **link**, because a link is the entire purpose of
the message. They name no patient and no appointment. The invitation names the
inviter's first name only — without it the recipient cannot distinguish a
genuine invitation from a phishing attempt, which is the worse outcome.

## How the classification is enforced

- **Logging**: `apps/api/src/common/logging/redaction.ts` — applied at the
  logger, not at call sites. Tested by logging through a real pino instance and
  reading what came out.
- **Notifications**: asserted against real bodies in
  `apps/api/test/notifications.e2e-spec.ts`, not against a template.
- **Audit**: asserted in `apps/api/test/authorization.e2e-spec.ts` — the
  serialised audit rows must not contain a patient name, a phone number or an
  email address.
- **Retention**: [retention-schedule.md](retention-schedule.md).
