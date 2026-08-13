# ADR-0003 · Application-managed auth, not Cognito or Auth0

**Status:** Accepted · **Date:** 2026-07-27

## Context

Our authorisation model is dominated by the **`PatientAccess` relationship** —
a user's permission set for a specific patient, revocable, with history. No
managed identity provider models that natively.

Our users are mostly free-tier family members, which makes a per-MAU price
curve unattractive in exactly the direction we would be growing.

## Decision

Authentication implemented in the application: argon2id password hashing,
short-lived JWT access tokens, opaque rotating refresh tokens in families,
TOTP MFA, and our own reset and verification flows.

## Alternatives

**AWS Cognito.** Same AWS account, signable BAA. But the `PatientAccess` logic
would live in our database regardless, so we would have *both* — plus a
synchronisation problem between two user stores, which is a category of bug
with no good failure mode.

**Auth0 / Clerk.** Better developer experience, worse cost curve for our user
shape, and the same synchronisation problem.

Both also make local development depend on a network service, which is a real
cost on the first day of somebody's employment.

## Consequences

**We own** password storage, reset flows, MFA, lockout and session management.
Implemented once, tested hard:

- 21 integration tests covering the lifecycle, including refresh-token reuse
  detection and the identical-response property for unknown accounts.
- TOTP verified against the RFC 6238 published vectors.
- The negative-path helper set applied to every protected surface.

**We get** a self-contained local environment, no per-MAU cost, and an
authorisation model that is one implementation rather than one-plus-a-mapping.

## Revisit when

**Enterprise SSO / SCIM (Stage 5E).** That is the point where a managed
provider genuinely pays for itself: SAML, OIDC federation and directory sync
are a large amount of undifferentiated work, and by then the tenancy model that
would consume them exists.
