# SECURITY.md

Security posture for the CareBridge MVP.

> **This application makes no claim of HIPAA compliance** and does not operate
> as a covered entity or business associate. The primary risk control is data
> minimisation: we do not collect clinical information at all. See
> [PRIVACY-DATA-MAP.md](PRIVACY-DATA-MAP.md).

---

## Reporting a vulnerability

This is a pre-release project with no public deployment. Report issues through
the repository's issue tracker, marked `security`, without including any real
personal data in the report. A disclosure policy and contact address are open
items before launch.

---

## What we are protecting

Personal information about identifiable older adults — where they live, when
they will be away from home, who is coming to collect them, and the fact that
they are seeing a doctor. This is attractive to two very different attackers:
someone after data in bulk, and someone targeting one specific person. The
controls below are aimed at both.

---

## Controls

### Configuration and secrets

| Control                                        | Status | Where                       |
| ---------------------------------------------- | ------ | --------------------------- |
| All configuration validated by Zod at startup  | ✅     | `src/lib/env/schema.ts`     |
| Server secrets isolated behind `server-only`   | ✅     | `src/lib/env/server.ts`     |
| Public config physically separate, no secrets  | ✅     | `src/lib/env/client.ts`     |
| Direct `process.env` access blocked by lint    | ✅     | `eslint.config.mjs`         |
| Test asserts no public key name looks secret   | ✅     | `tests/unit/env-schema.test.ts` |
| `.env*` git-ignored; `.env.example` has names only | ✅  | `.gitignore`, `.env.example` |
| Env validation errors report names, never values | ✅   | `describeEnvIssues()`       |

### Logging

| Control                                          | Status | Where                      |
| ------------------------------------------------ | ------ | -------------------------- |
| Structured logger, redaction applied to all metadata | ✅ | `src/lib/logger/`          |
| Key-based redaction (names, phones, addresses, notes, tokens) | ✅ | `redact.ts`     |
| Value-based scrubbing (email, phone, long digit runs) | ✅ | `redact.ts`            |
| Depth / breadth / length caps so records cannot be dumped | ✅ | `redact.ts`       |
| `console` blocked by lint outside the logger     | ✅     | `eslint.config.mjs`        |

### Errors

| Control                                                 | Status | Where               |
| ------------------------------------------------------- | ------ | ------------------- |
| Typed error taxonomy with explicit user-safe messages   | ✅     | `src/lib/errors.ts` |
| Unknown errors surface a generic message only           | ✅     | `toUserMessage()`   |
| Authorization and not-found share a message, so record existence cannot be probed | ✅ | `src/lib/errors.ts` |
| Error boundary renders no raw error text, only a digest | ✅     | `src/app/error.tsx` |

### Transport and headers

| Control                                     | Status | Where            |
| ------------------------------------------- | ------ | ---------------- |
| `X-Content-Type-Options: nosniff`           | ✅     | `next.config.ts` |
| `X-Frame-Options: DENY`                     | ✅     | `next.config.ts` |
| `Referrer-Policy: strict-origin-when-cross-origin` | ✅ | `next.config.ts` |
| `Permissions-Policy` denying camera/mic/geo/payment | ✅ | `next.config.ts` |
| `Cross-Origin-Opener-Policy: same-origin`   | ✅     | `next.config.ts` |
| `Strict-Transport-Security`                 | ✅     | `next.config.ts` |
| `X-Powered-By` removed                      | ✅     | `next.config.ts` |
| Headers asserted in end-to-end tests        | ✅     | `tests/e2e/`     |

### Architecture

| Control                                                   | Status | Where               |
| --------------------------------------------------------- | ------ | ------------------- |
| Server infrastructure imports blocked from UI components  | ✅     | `eslint.config.mjs` |
| Domain layer kept pure (no React/Next/DB)                 | ✅     | `eslint.config.mjs` |
| Status transitions centralised and exhaustively tested    | ✅     | `modules/*/domain/` |
| Role permission encoded per transition, tested per role   | ✅     | `tests/unit/`       |
| App excluded from search indexing                         | ✅     | `src/app/layout.tsx` |

---

## Implemented in Phase 2

| Control                                                            | Where                                   |
| ----------------------------------------------------------------- | --------------------------------------- |
| Supabase Auth, cookie-based sessions, per-request refresh          | `src/proxy.ts`, `src/server/supabase/*` |
| Server-side authorization layer (role + ownership)                 | `src/server/authz/*`                    |
| PostgreSQL Row Level Security on every table (verified)            | `drizzle/0001_*`, `tests/integration/`  |
| Signup role from `app_metadata` only (no self-escalation)          | `handle_new_user` trigger               |
| Content-Security-Policy header on every response                   | `src/server/security/csp.ts`, `proxy.ts`|
| Append-only audit writer with metadata redaction                   | `src/server/audit/`                     |
| Secrets isolated server-side; service-role key never in browser    | `src/server/supabase/admin.ts`          |

## Known gaps

Tracked deliberately. Each has an owning phase.

| Gap                                                                    | Phase |
| --------------------------------------------------------------------- | ----- |
| CSP hardening to nonce + `strict-dynamic` (see DECISIONS #8)           | 7     |
| Audit events wired into every mutation path (writer exists)            | 3–5   |
| CSRF posture review for server actions                                 | 3     |
| Rate-limiting interface for sensitive endpoints                        | 3     |
| Stripe webhook signature verification and idempotency                  | 6     |
| Notification content review (no sensitive detail in SMS/email)         | 6     |
| MFA for operations accounts                                            | 7     |
| Sentry SDK wiring (seam exists, disabled without a DSN)                | 7     |
| Dependency and supply-chain scanning in CI                             | 7     |
| Backup, retention and deletion procedures                              | 7     |
| Penetration test and independent review                                | 7     |

---

## Rules that must not be relaxed

Repeated here because they are the ones most likely to be traded away under
time pressure. The full list is in [CLAUDE.md](CLAUDE.md) §6.

- Authorization is checked **on the server**, every time. Hidden UI is not a
  control.
- RLS is **defence in depth**, not a substitute for the application check.
- Every mutation validates its input with Zod.
- Nothing sensitive is logged, ever, including "just while debugging".
- No real personal or health data in this system, including in seeds and tests.
- Webhooks are verified before they are parsed, and processed idempotently.
