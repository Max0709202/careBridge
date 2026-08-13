# Security

## Reporting a vulnerability

Email **security@carebridge.example** *(placeholder pending a real address)*.

Please include what you found, how to reproduce it, and what you were able to
access. We will acknowledge within two working days.

**Please do not** open a public issue, and please do not access, modify or
retain any data belonging to a real person while demonstrating an issue.

## What we consider most serious

In rough order of how badly it would hurt the people this product exists for:

1. **A patient's live position visible to someone without a grant.** This is
   the P0 surface. A ride id is not a capability.
2. **Cross-family data access** of any kind — a home address, a schedule, a
   mobility requirement.
3. **Account takeover**, particularly through the invitation flow: what an
   invitation grants is standing access to a vulnerable person's address and
   daily movements.
4. **Personal data in logs.** The redaction denylist is applied at the logger
   precisely so this is hard to do by accident; a way around it is a finding.
5. **Audit-log tampering.** The log is append-only with no update or delete
   path in the application.
6. Session fixation or refresh-token replay that the family-revocation
   mechanism does not catch.

## Things that are intentional, not bugs

- **`404` for both "not found" and "not permitted".** Identical message,
  identical status. This is deliberate: distinguishing them would make the API
  a way to probe for the existence of a patient record. Reporting that "the API
  returns 404 for a resource that exists" is a report of a feature.
- **The same response and timing for an unknown account and a wrong password.**
  Also deliberate, and the server verifies against a dummy argon2 hash to make
  the timing match.
- **Registration succeeds before email verification.** Nothing is blocked on
  verification except invitations. Locking a family out of a ride they have
  already booked because an email went to spam is the worse outcome.
- **The Android driver app shows a persistent notification while tracking.**
  That is the honest version of this permission, not a leak.
- **`/api/v1/docs` is served outside production.** It is absent in production.

## Our practices

Summarised here; described fully in
[docs/architecture/security-model.md](docs/architecture/security-model.md).

- argon2id password hashing at the OWASP-recommended floor.
- Short-lived access tokens carrying no patient identifiers; opaque rotating
  refresh tokens in families, with reuse detection.
- One authorisation policy service, with a negative-path test set as a merge
  requirement.
- Append-only audit, written in the same transaction as the change it
  describes, recording changed field **names** and never values.
- Structured logging with a redaction denylist applied at the logger.
- Dependency, secret and container scanning in CI, blocking on high severity.

## Compliance

We describe this system as **"HIPAA-ready architecture"** and never as "HIPAA
compliant". Compliance requires a legal determination of our role, executed
BAAs, documented administrative and physical safeguards, workforce training,
access reviews and an incident-response process — none of which are properties
of source code.

CI fails a pull request that adds the stronger claim.
