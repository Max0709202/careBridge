# Security model

## Authentication

Application-managed in NestJS rather than Cognito or Auth0
([ADR-0003](../adr/0003-application-managed-auth.md)).

- **argon2id**, 19 MiB memory / 2 passes — the OWASP floor. Memory cost is what
  makes GPU cracking expensive, so it is the parameter to raise first.
- **Access tokens** are short-lived JWTs carrying the user id, a token version
  and the session id. **Never** patient identifiers or an organisation list —
  those are resolved server-side per request, so revocation is immediate.
- **Refresh tokens** are opaque, stored hashed, rotated on every use, and
  grouped in families. Presenting a rotated token revokes the whole family and
  raises a security event: two parties hold tokens from one login and we cannot
  tell which is legitimate, so both sign in again.
- **Token version** is bumped by sign-out-everywhere and by a password change.
  Revoking refresh tokens alone would leave every already-issued access token
  working until it expired.
- Tokens live in `flutter_secure_storage` — Keychain / EncryptedSharedPreferences
  — never in shared preferences.
- Failed logins are rate-limited per email + IP with progressive lockout.

**Two responses that are deliberately identical.** A wrong password and an
unknown account return the same message, the same code and — because the server
verifies against a dummy argon2 hash when the account does not exist — take the
same time. Otherwise login latency is a user-enumeration oracle, and for this
product the user list is a list of people with a vulnerable relative.

### MFA

TOTP, RFC 6238, implemented against the published test vectors. The shared
secret is encrypted at rest with AES-256-GCM under a key that lives in Secrets
Manager and not in the database.

Two properties worth stating:

- **Enrolment is not complete until a code is verified.** Marking MFA active
  when the QR code is displayed locks out anyone whose authenticator failed to
  scan it — with no second factor to recover with, by definition.
- **If the key is absent, enrolment is refused** rather than done insecurely. A
  user told "two-factor is on" while the secret sits in plaintext has been
  given a false belief about their own security, which is worse than the
  feature being unavailable.

## Authorisation

**One policy service.** Every protected operation answers six questions in
order: who, what role, which organisation, what relationship to this patient,
who owns this resource, is this operation permitted.

Enforced by a guard **plus** an explicit policy call in the service layer.
Never by hiding a button, never re-implemented per module — two implementations
of an authorisation rule eventually disagree, and the disagreement is a data
leak.

### The response that refuses to distinguish

`AuthorizationError` and `NotFoundError` carry the **same message and the same
404**. "No such patient" and "not your patient" must not be tellable apart, or
the error becomes a probe. This is asserted by
`expectsIndistinguishableDenial` in the negative-path helper set, which
compares the two responses byte for byte rather than only their status codes.

### The negative-path helper set

FOUNDATION §9 makes these a **merge requirement**. Authorisation bugs do not
announce themselves: a wrong-family read returns a 200 with somebody's home
address in it, and every positive test still passes.

| Helper | Catches |
| ------ | ------- |
| `expectsAuthentication` | The endpoint forgot to be protected at all |
| `expectsIndistinguishableDenial` | It checks access but leaks existence through the error |
| `expectsRevocationTakesEffect` | It reads a grant but not its `revokedAt` |
| `expectsPermissionScope` | It confirms *a* grant rather than the specific permission |
| `expectsSingleUse` | A single-use credential can be spent twice |

## Invitations

Named in FOUNDATION §5 as an account-takeover vector, and treated as one. What
an invitation grants is standing access to a vulnerable person's home address,
appointment schedule and live position.

| Property | Without it |
| -------- | ---------- |
| **Email-bound** — acceptance requires being signed in as the invited address | The link *is* the grant, and links travel through forwarded mail, shared inboxes and screenshots |
| **Verified-address-bound** — the accepting account must have verified it | Anyone registers with the invited address and accepts; the binding proves nothing |
| **Single-use, consumed transactionally** | Two taps produce two grants, or a race produces a grant plus an error |
| **Expiring, with bounded attempts** | A stale invitation in an archived inbox is a live credential forever |
| **Inviter must be verified** | An unproven mailbox builds a graph of grants |
| **No grant broader than the inviter's own** | A view-only relative invites an accomplice as a full manager |

The token is stored only as a digest, so a database dump is not a set of live
invitations.

## Audit

Append-only, written for every mutation, every administrative action, every
consent change, and sensitive reads. Records actor, role, action, entity,
organisation, correlation id, IP and user agent.

Changed **field names** are recorded; changed **values** are not. Audit writes
participate in the same transaction as the change they describe, so an audited
action cannot succeed unaudited.

## Encryption

TLS 1.2+ everywhere in production, HSTS, no plaintext listener. At rest: RDS,
ElastiCache, S3 and EBS encrypted with KMS. S3 objects are private with no
public ACL path, reachable only through short-lived pre-signed URLs issued
after an authorisation check. Secrets live in Secrets Manager, injected as
task-definition secrets — never in an image, a repository, or a client bundle.

## Logging

Structured JSON via pino with a **redaction denylist applied at the logger**,
not at call sites. This placement is the whole point: a denylist enforced by
remembering to scrub before each call fails the first time someone logs a whole
object during a 2am incident — which is exactly when the most sensitive objects
are being logged.

`console` is banned by lint, because it bypasses the denylist entirely.
`process.env` is readable in exactly one file.

Users see a generic message plus a correlation id; the detail stays
server-side.

## Rate limiting

Three policies, on the endpoints an unauthenticated caller can reach. They are
separate because what they protect fails in different ways.

| Policy | Routes | Keyed on | What it stops |
| --- | --- | --- | --- |
| `signIn` | `POST /auth/login` | failures per email+IP, and all attempts per IP | Guessing one password; spraying one password across many accounts |
| `emailDispatch` | register, resend-verification, password-reset | IP **and** address | Using this system to deliver mail to a stranger |
| `tokenGuess` | verify-email, reset confirm, invitation accept, MFA confirm | IP | Grinding a single-use secret — a TOTP code is only 10⁶ wide |

Two dimensions rather than one, on the policy where it matters: per-IP alone
lets one host mail a thousand addresses, per-address alone lets a thousand
hosts mail one. Both are counted and either can refuse.

Sign-in counts **failures only**, which is why it is enforced in the service
rather than in the guard — someone signing in successfully from several devices
is a person, not an attack. A success clears the counter.

The 429 carries `Retry-After` and a message that says nothing about which limit
was reached. "Too many attempts for that email address" would confirm the
address has an account, which every other response on those routes is careful
not to do.

Counters live behind a port with two adapters, the same arrangement as the
queue: Redis wherever more than one process serves traffic, an in-process map
on a laptop with no Redis. The in-process one is *wrong* with more than one
instance — the effective limit multiplies by the instance count — so the API
says which is live at boot and production refuses to start without Redis. When
Redis is unreachable at request time the decision is to allow: it is a cache,
never the source of truth, and failing closed would turn a cache blip into a
total sign-in outage for every family at once.

The client address comes from `X-Forwarded-For`, trusting exactly
`TRUST_PROXY_HOPS` proxies (1 — nginx). Too low and everyone shares one bucket;
too high and a caller forges the header for a fresh bucket per request.

## Application hardening

DTO validation at every boundary, with unknown fields dropped rather than
passed through. Parameterised queries only. Helmet. A CORS allowlist per
environment, and `*` refused outright in production. Uploads restricted by type
and size with server-generated keys. Webhook signatures verified **before**
parsing.

Idempotency on the endpoints that create things — patients, clinics,
appointments, rides, invitations. A client sends `Idempotency-Key`; the key is
claimed by inserting a row before the handler runs, so two concurrent retries
race on a unique constraint and exactly one proceeds. A repeat returns the
stored response with `Idempotent-Replay: true`; the same key with a different
body is refused rather than answered with the first one's result; a failed
request releases its claim, because it did not happen and must stay retryable.
The request body is *hashed*, not stored — these bodies carry addresses and
appointment times, and keeping a copy for a day would be a second store of
exactly the data the rest of this document is careful about. Records expire
after 24 hours, swept by the retention job.

The client-supplied correlation id is length- and pattern-checked before being
echoed in a response header and written to a log — an unbounded client string
there is header injection and log forging at the same time.

## Compliance posture

**"HIPAA-ready architecture"**, never "HIPAA compliant". Compliance requires a
legal determination of our role (L1), executed BAAs, documented administrative
and physical safeguards, workforce training, access reviews and an
incident-response process — none of which are properties of source code.

CI fails a pull request that adds the stronger phrase.
