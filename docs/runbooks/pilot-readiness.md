# Getting to a real test

Everything in this repository runs on a laptop with `docker compose up`, and
none of that is evidence. This is the list of what has to become real before
anybody who is not being paid to be patient uses CareBridge, in the order the
items block each other.

Three kinds of testing, and they need different things:

| | What it proves | What it needs |
| --- | --- | --- |
| **Internal** — the team, on staging | The build works on real devices | A staging environment, real devices, test accounts |
| **Field test** — one car, one route | Battery and coverage claims are true | [`field-test.md`](field-test.md), a driver, a car |
| **Pilot** — real families, real journeys | The product works | All of the above, plus vendors, plus consent |

---

## 1. A staging environment that exists

Terraform describes staging and production and both `terraform validate` in CI.
Neither has been applied. Until one is, there is nothing for a phone to talk
to — and a phone is the one client that cannot be pointed at `localhost`.

```bash
cd infrastructure/terraform/environments/staging
terraform init && terraform plan
```

This needs an AWS account and it will spend money: RDS, ElastiCache, ALB,
Fargate, a NAT gateway. Budget for the NAT gateway in particular — it is the
line item that surprises people on a staging environment that is idle most of
the week.

**Blocks:** everything below. A device build needs an HTTPS URL, and iOS App
Transport Security will not accept a cleartext one.

---

## 2. The vendor accounts

Every vendor sits behind a port with a local adapter, and **production refuses
the local adapter** — config validation fails the container at boot rather than
letting it run while doing nothing. That is the right behaviour and it means
each of these is a hard blocker for a deployed environment, not a nice-to-have.

| Vendor | Driver | State | What it costs to leave undone |
| --- | --- | --- | --- |
| **Email** (SES) | `MAIL_DRIVER=smtp` | Written, pointed at Mailpit locally | No verification, no reset, no invitations. Nobody can sign up. |
| **Maps** (Google) | `MAPS_DRIVER=google` | Written, never called against the live API | Geocoding falls back to plausible-looking coordinates, and the route view is schematic by design |
| **Push** (FCM) | `PUSH_DRIVER=fcm` | Written, untested against a live project | Status changes are found by a 5-second poll. Tolerable for a pilot; not for launch. |
| **Payments** (Stripe) | `PAYMENTS_DRIVER=local` | Adapter written and typed, never exercised against a live account | No money moves. A pilot can run free; a paid pilot cannot. |

SES starts in a **sandbox** that only sends to verified addresses, and getting
out of it is a support request that takes days. Start it early — it is the same
shape of delay as the Apple Developer enrolment.

The Stripe path needs the card sheet wired into both apps. Neither app collects
a card number and neither should: both take the token the processor's sheet
supplies, and swapping the widget in is the whole change (ADR-0006).

---

## 3. Devices

| | Minimum | Why |
| --- | --- | --- |
| iPhone | 1, iOS 15+ | The driver app's background behaviour cannot be tested in a simulator |
| Android | 2, one of them cheap and old | The foreground service and battery claims are about a phone in a cradle for half an hour, and the aggressive OEM battery killers are on the cheap phones |
| A car | 1 | See below |

**The emulator always says yes.** Whether Android keeps delivering positions
with the screen off, behind a navigation app, for thirty minutes, on a
manufacturer's battery optimiser, is not learnable from a keyboard.

---

## 4. The field test

[`field-test.md`](field-test.md) is written, executable, and has not been run.
It is the one Stage 3 acceptance item that needs a car. It measures two things
that are currently designed for rather than measured — battery drain against
the 25%-over-four-hours threshold in ADR-0005, and whether real dead zones are
shorter than the offline queue.

Run it before the pilot, not during it. A pilot that discovers the battery
claim is wrong has discovered it using somebody's mother.

---

## 5. Accounts and data for testing

- **A durable reviewer account** on staging and on production, for both apps,
  that the seed does not reset. Both store reviewers need one, and the driver
  account needs a job already assigned — see
  [`../product/store-listing.md`](../product/store-listing.md).
- **`SEED_ON_START=false`** on any environment real people touch. The demo
  family is idempotent, not harmless: a pilot family should not find Eleanor
  in their care circle.
- **A real `JWT_SECRET`** — the API refuses to start without one, which is the
  correct behaviour and worth not working around.

---

## 6. The things that are not code

**Consent and a privacy policy.** The app collects home addresses, medical
appointment times and live location about people who are, in most cases, *not
the user*. The patient is usually not the account holder. A consent model that
only asks the daughter is not consent, and both stores require a reachable
privacy policy URL before submission.

**Account deletion.** Required by both stores and not implemented — see
[ADR-0013](../adr/0013-account-deletion.md). This blocks the Play Data safety
form, which asks directly whether users can request deletion.

**A restore drill.** `docs/architecture/disaster-recovery.md` describes the
RPO and RTO. Nothing has ever been restored. A backup nobody has restored is
not a backup, and finding that out during a pilot means finding it out with
somebody's data.

**Who answers the phone.** A driver is late, a family is worried, and an app is
not a person. Decide this before the pilot rather than discovering it at 8am
on the first Monday.

---

## Order of operations

```
AWS account ─┬─> staging applied ─┬─> device builds ─> internal testing
             │                    │
SES sandbox ─┘                    └─> field test ─> pilot
                                                     ▲
account deletion (ADR-0013) ─> store submission ─────┘
```

The two long poles are **Apple Developer enrolment** (days to weeks for an
organisation) and **SES sandbox exit** (days). Both are pure waiting and both
can be started today, before a single one of the items above is done.
