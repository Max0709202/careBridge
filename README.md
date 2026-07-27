# CareBridge

Coordinated transportation and optional non-medical companion support for a
family member's **existing** medical appointment.

An adult child submits a request. A human operations scheduler reviews it,
arranges the ride, and assigns a companion when one is needed. This is a
**managed concierge service**, not an open marketplace — nothing is
auto-matched and nothing is dispatched without a coordinator.

> **Pre-release MVP.** Do not put real patient, health, or personal
> information into this application. No claim of HIPAA compliance is made.
> CareBridge provides no medical care, advice, diagnosis, or emergency service.

---

## Status

| Phase | Scope                                                               | State          |
| ----- | ------------------------------------------------------------------- | -------------- |
| 1     | Scaffold, tooling, structure, env validation, docs, public pages     | ✅ Complete    |
| 2     | Supabase, auth, roles, schema, migrations, seed, RLS, authz tests    | ✅ Complete    |
| 3     | Family portal, senior profiles, request workflow, audit events       | ⬜ Not started |
| 4     | Caregiver portal, availability, assignments, check-in/out, incidents | ⬜ Not started |
| 5     | Operations dashboard, review, manual assignment, notes, audit viewer | ⬜ Not started |
| 6     | Payments, notifications, secure webhooks                             | ⬜ Not started |
| 7     | Accessibility review, security review, full suite, deploy docs       | ⬜ Not started |

---

## Tech stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui ·
Supabase (Postgres + Auth) · Drizzle ORM · Zod · React Hook Form ·
Vitest · Playwright · ESLint · Prettier · date-fns

A **modular monolith** in one repository. No microservices.

---

## Quick start

```bash
pnpm install
cp .env.example .env.local     # placeholders are fine for Phase 1
pnpm dev                       # http://localhost:3000
```

Phase 1 runs with **no credentials at all**. Every external integration has a
local development adapter that logs a safe, redacted message rather than
calling out to a third party.

Full setup, including Windows + WSL 2, is in
[docs/LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md).

---

## Commands

| Command                 | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `pnpm dev`              | Development server                             |
| `pnpm build`            | Production build                               |
| `pnpm start`            | Serve the production build                     |
| `pnpm lint`             | ESLint (includes architectural boundary rules) |
| `pnpm lint:fix`         | ESLint with autofix                            |
| `pnpm format`           | Prettier write                                 |
| `pnpm format:check`     | Prettier check                                 |
| `pnpm typecheck`        | `tsc --noEmit`                                 |
| `pnpm test`             | Vitest unit tests                              |
| `pnpm test:watch`       | Vitest in watch mode                           |
| `pnpm test:coverage`    | Vitest with coverage                           |
| `pnpm test:e2e`         | Playwright (builds and serves on port 3100)    |
| `pnpm test:e2e:install` | Install Playwright browsers (first run only)   |
| `pnpm check`            | lint + typecheck + unit tests                  |
| `pnpm test:rls`         | RLS ownership tests (in-process, no Docker)    |
| `pnpm supabase:start`   | Start the local Supabase Docker stack          |
| `pnpm db:migrate`       | Apply Drizzle migrations                        |
| `pnpm db:seed`          | Load fictional development data                 |
| `pnpm db:reset`         | Drop, re-migrate, and re-seed the local DB      |

Database and auth setup (Docker + Supabase) is documented in
[docs/DATABASE.md](docs/DATABASE.md).

---

## Project layout

```
src/
  app/
    (public)/          Landing, how-it-works, safety, privacy, terms, sign-in, sign-up
    layout.tsx         Root layout, fonts, metadata
    error.tsx          Generic error boundary (never renders raw error text)
    not-found.tsx
  components/
    ui/                shadcn/ui primitives, tuned for larger touch targets
    layout/            Header, footer, page shells
  modules/             Feature modules. Each owns its own domain rules.
    auth/domain/       Roles
    service-requests/  Request lifecycle state machine
    assignments/       Assignment lifecycle state machine
  lib/
    env/               Zod-validated configuration (schema / client / server)
    logger/            Structured logger + redaction
    observability/     Error reporting seam (Sentry-ready, disabled)
    datetime.ts        UTC storage, service-location display
    errors.ts          Error taxonomy; user-safe vs log-only messages
    site-config.ts
tests/
  unit/                Vitest
  e2e/                 Playwright
  stubs/
docs/
```

Layers added in later phases: `src/server/db`, `src/server/authz`,
`src/server/audit`, `src/integrations/{payments,sms,email}`.

---

## Documentation

| Document                                                    | Contents                                              |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                       | Conventions, commands, definition of done, boundaries |
| [SECURITY.md](SECURITY.md)                                   | Security posture, controls, known gaps                |
| [PRIVACY-DATA-MAP.md](PRIVACY-DATA-MAP.md)                   | Every field collected, why, who sees it               |
| [THREAT-MODEL.md](THREAT-MODEL.md)                           | Assets, actors, threats, mitigations                  |
| [docs/AUTHORIZATION-MATRIX.md](docs/AUTHORIZATION-MATRIX.md) | Role × resource × action                              |
| [docs/STATUS-MACHINE.md](docs/STATUS-MACHINE.md)             | Allowed status transitions and who may make them      |
| [docs/DECISIONS.md](docs/DECISIONS.md)                       | Decision log, including data-minimisation choices     |
| [docs/LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md)       | Setup, including Windows + WSL 2                      |

---

## Non-goals

Deliberately out of scope, and not to be added without an explicit decision:

AI medical advice, diagnosis, or triage · medication management · insurance
claims or billing · EHR/EMR integration · live GPS or driver tracking ·
automatic caregiver matching · caregiver payouts · microservices.
