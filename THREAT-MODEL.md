# THREAT-MODEL.md

A working threat model for the CareBridge MVP. Revisited at the end of each
phase; the mitigation status column is kept honest.

Status key: ✅ implemented · 🟡 partial · ⬜ planned (phase noted)

---

## 1. Assets

| # | Asset                                | Why an attacker wants it                                                   |
| - | ------------------------------------ | -------------------------------------------------------------------------- |
| A1| Senior profiles                      | Address, phone, mobility limitations, and emergency contact for an identifiable older adult |
| A2| Appointment schedules                | Says exactly when a specific home will be empty, and when its occupant is away and unaccompanied |
| A3| Clinic names                         | Can imply a medical specialty, and therefore a health condition            |
| A4| Internal operations notes            | Candid staff assessments; damaging if seen by the family or the caregiver they describe |
| A5| Incident reports                     | Evidence of things going wrong; sensitive to everyone involved              |
| A6| Audit log                            | A map of who did what; also a target for tampering to hide activity        |
| A7| Credentials and sessions             | Account takeover leads to all of the above                                 |
| A8| Service-role database key            | Bypasses Row Level Security entirely                                       |
| A9| Payment state                        | Fraud, and reconciliation confusion                                        |

**A2 is the asset most often underrated.** A list of "who is out of the house
on Tuesday at 10am, and needs help walking" is a burglary and elder-abuse
target, quite apart from any health inference.

---

## 2. Actors

**Legitimate:** family user · caregiver · operations admin · the platform's own
background jobs.

**Adversarial:**

| Actor                       | Capability                                     | Motivation                    |
| --------------------------- | ---------------------------------------------- | ----------------------------- |
| Unauthenticated internet    | Public endpoints, guessed ids, scraping        | Bulk data, opportunistic      |
| Authenticated family user   | Valid session, one family's scope              | Curiosity, or targeting another family |
| Authenticated caregiver     | Valid session, own assignments                 | Curiosity; scouting targets among clients |
| Malicious/compromised operations account | Broad legitimate access             | Insider abuse                 |
| Someone targeting one senior| May know names, addresses, family relationships| Elder abuse, theft, coercion  |
| Compromised third party     | Vendor breach (Supabase, Stripe, Twilio, Resend)| Data in transit or at rest   |
| Household member with device access | Sees an unlocked phone's notifications | Coercive control              |

That last one is why notification bodies carry no detail.

---

## 3. Threats and mitigations

### T1 — Horizontal privilege escalation (family reads another family's data)

*Likelihood: high. Impact: high.* The classic IDOR: change the UUID in a URL.

| Mitigation                                                          | Status        |
| ------------------------------------------------------------------- | ------------- |
| Ownership checked server-side on every read and write                | ⬜ Phase 2–3  |
| RLS policies scoping rows to the caller's family account             | ⬜ Phase 2    |
| UUID primary keys (not sequential integers)                          | ⬜ Phase 2    |
| Authorization failure indistinguishable from not-found               | ✅ `src/lib/errors.ts` |
| Negative tests: wrong family cannot read or mutate                   | ⬜ Phase 2–3  |

### T2 — Caregiver over-reach

*Likelihood: medium. Impact: high.* A caregiver reading clients they were never
assigned, or reading internal notes written about them.

| Mitigation                                                     | Status       |
| -------------------------------------------------------------- | ------------ |
| Assignment-scoped queries, never request-scoped                 | ⬜ Phase 4   |
| Internal notes in a separate table with an operations-only policy| ⬜ Phase 2/5 |
| Caregiver-facing DTOs exclude internal fields by construction    | ⬜ Phase 4   |
| Negative tests for unassigned access and note visibility         | ⬜ Phase 4   |

### T3 — Privilege escalation to operations

*Likelihood: medium. Impact: critical.*

| Mitigation                                              | Status       |
| -------------------------------------------------------- | ------------ |
| Role stored server-side, never accepted from the client   | ⬜ Phase 2   |
| Role changes are an audited, admin-only operation         | ⬜ Phase 2   |
| Assignment restricted to operations, enforced in the domain layer | ✅ `modules/service-requests/domain/status.ts` |
| Tested per role, exhaustively                             | ✅ `tests/unit/` |

### T4 — Data leakage through logs, errors, or telemetry

*Likelihood: high (accidental). Impact: high.* The most likely real incident: a
developer logs a record while debugging and it lands in a log aggregator.

| Mitigation                                          | Status                    |
| ---------------------------------------------------- | ------------------------- |
| Redacting logger; key- and value-based scrubbing     | ✅ `src/lib/logger/`      |
| `console` blocked by ESLint                          | ✅ `eslint.config.mjs`    |
| Depth/breadth caps so a whole record cannot be dumped| ✅ `redact.ts`            |
| Generic user-facing errors; detail stays server-side | ✅ `src/lib/errors.ts`    |
| Error boundary shows a digest, never error text      | ✅ `src/app/error.tsx`    |
| Audit events store references, not record contents   | ⬜ Phase 2–3 (specified)  |
| No personal data sent to analytics                   | ✅ (no analytics present) |

### T5 — Credential and session attacks

*Likelihood: high. Impact: critical.*

| Mitigation                                                   | Status     |
| ------------------------------------------------------------ | ---------- |
| Supabase Auth; no hand-rolled password handling               | ⬜ Phase 2 |
| httpOnly, Secure, SameSite cookies                            | ⬜ Phase 2 |
| Rate limiting on authentication endpoints                     | ⬜ Phase 3 |
| Audit events for authentication-relevant account changes      | ⬜ Phase 2 |
| No secrets in the browser bundle                              | ✅ `src/lib/env/` |
| No session material in logs                                   | ✅ `redact.ts` |

### T6 — Injection

*Likelihood: medium. Impact: critical.*

| Mitigation                                        | Status                    |
| ------------------------------------------------- | ------------------------- |
| Parameterised queries via Drizzle; no raw string SQL | ⬜ Phase 2            |
| Zod validation at every boundary                   | 🟡 Env done; requests Phase 3 |
| React escapes output by default; no `dangerouslySetInnerHTML` | ✅            |
| Content-Security-Policy with nonce                 | ⬜ Phase 2 (needs middleware) |

### T7 — Webhook forgery and replay

*Likelihood: medium. Impact: high.* An unauthenticated endpoint that changes
payment state is an obvious target.

| Mitigation                                    | Status     |
| --------------------------------------------- | ---------- |
| Stripe signature verified before parsing      | ⬜ Phase 6 |
| Idempotency keyed on the provider's event id  | ⬜ Phase 6 |
| Webhook processing never trusts amounts from the request body | ⬜ Phase 6 |
| Idempotency covered by tests                  | ⬜ Phase 6 |

### T8 — Insider abuse by an operations admin

*Likelihood: low. Impact: high.* Operations legitimately need broad access;
the control is accountability, not prevention.

| Mitigation                                            | Status     |
| ----------------------------------------------------- | ---------- |
| Audit events for sensitive administrative access      | ⬜ Phase 5 |
| Audit viewer for review                               | ⬜ Phase 5 |
| Audit records not editable through the application    | ⬜ Phase 2 |
| Least privilege among operations staff                | ⬜ Post-MVP |

### T9 — Enumeration and scraping

*Likelihood: medium. Impact: medium.*

| Mitigation                                        | Status     |
| ------------------------------------------------- | ---------- |
| UUID identifiers                                  | ⬜ Phase 2 |
| Uniform authorization/not-found responses         | ✅         |
| Rate limiting on sensitive endpoints              | ⬜ Phase 3 |
| Application excluded from search indexing         | ✅ `layout.tsx` |
| No personal data in URLs                          | ✅ (policy) |

### T10 — Supply chain

*Likelihood: medium. Impact: critical.*

| Mitigation                                             | Status     |
| ------------------------------------------------------ | ---------- |
| Lockfile committed; pnpm supply-chain policy check      | ✅         |
| Postinstall build scripts opt-in, two packages reviewed | ✅ `pnpm-workspace.yaml` |
| Dependency scanning in CI                               | ⬜ Phase 7 |
| Dependency review before adding anything new            | ✅ (policy, CLAUDE.md) |

### T11 — Physical / social context

*Likelihood: medium. Impact: high.* Not a software vulnerability, but a real
harm path: a notification read by the wrong person in the same household.

| Mitigation                                                    | Status     |
| ------------------------------------------------------------- | ---------- |
| Notifications carry no appointment, clinic, or health detail   | ⬜ Phase 6 (specified) |
| Detail only behind authentication                              | ⬜ Phase 2 |
| No live location tracking to leak in the first place           | ✅ (out of scope) |

---

## 4. Accepted risks

| Risk                                                              | Why accepted                                                        | Revisit  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| Coordination notes are free text and could receive clinical detail | Families need somewhere to say "ring the bell twice". Guided by label, never logged, access-controlled | Phase 7 |
| Clinic name can imply a condition                                  | A driver must know the destination                                   | —        |
| Operations admins can see all requests                             | The product is a managed service; a coordinator must coordinate. Controlled by audit | Phase 5 |
| Third-party processors hold data                                   | Building payments, SMS and email in-house would be worse             | Pre-launch |
| No multi-factor authentication in the MVP                          | Scope. Higher priority for operations accounts than for families     | Phase 7  |

---

## 5. Out of scope

Denial of service, physical security of vendor infrastructure, and endpoint
compromise of a user's own device are not addressed by this model.
