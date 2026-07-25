# CLAUDE.md — working agreement for this repository

CareBridge coordinates transportation and optional non-medical companionship
for a medical appointment that **already exists**. Read this file before
changing anything.

---

## 1. Commands

```bash
pnpm install            # install
pnpm dev                # dev server on :3000
pnpm build              # production build
pnpm start              # serve production build

pnpm lint               # ESLint, including architectural boundaries
pnpm typecheck          # tsc --noEmit
pnpm test               # Vitest unit tests
pnpm test:e2e           # Playwright (builds, serves on :3100)
pnpm format:check       # Prettier

pnpm check              # lint + typecheck + test — run before saying "done"
```

---

## 2. Architecture conventions

**Modular monolith, one repository. Do not create microservices.**

### Layers, in dependency order

```
app/            Routing and page composition. Thin.
components/     Presentation. Receives plain data as props.
modules/*/      Feature modules:
    domain/     Pure business rules. No React, no Next, no I/O, no DB.
    schemas/    Zod schemas for input at the boundary.
    data/       Database access for this feature. Server-only.
    actions/    Server actions / route handlers. The mutation entry point.
server/         Cross-cutting infrastructure: db, authz, audit.
integrations/   External services behind an interface + a dev adapter.
lib/            Framework-agnostic helpers: env, logger, errors, datetime.
```

Dependencies point **downward** only. `domain/` depends on nothing but `lib/`.

These boundaries are enforced by ESLint (`no-restricted-imports` in
`eslint.config.mjs`), not by good intentions. If a rule blocks you, the design
is wrong — do not add an eslint-disable.

### Rendering

- **Server Components by default.** Add `"use client"` only when the component
  genuinely needs browser state, effects, or event handlers.
- Client Components receive plain serialisable data as props. They never query
  the database and never read server configuration.
- No database access from `components/`. Fetch in a Server Component or a
  server action and pass data down.

### Mutations

Every server action and route handler performs, in this order:

1. **Authenticate** — resolve the session, or throw `AuthenticationError`.
2. **Authorize** — check role *and* ownership on the server, via
   `server/authz`. Never trust a hidden button.
3. **Validate** — parse input with Zod. Never trust a client-side check.
4. **Apply domain rules** — e.g. `assertTransition()` for status changes.
5. **Persist** — inside a transaction where more than one row changes.
6. **Audit** — write an audit event for anything security-sensitive or
   operationally important.
7. **Handle errors** — return a generic user message; log the detail server-side.

Steps 1–4 and 6 are not optional and not "to be added later".

### State machines

`src/modules/service-requests/domain/status.ts` and
`src/modules/assignments/domain/status.ts` are the only source of truth for
status changes. Do not hand-roll a status comparison anywhere else. See
[docs/STATUS-MACHINE.md](docs/STATUS-MACHINE.md).

### Time

- Store every timestamp in UTC (`timestamptz`).
- Store the service request's IANA time-zone name alongside it.
- Display appointment times in the **service location's** zone, labelled.
  Never in the viewer's local zone. Use `src/lib/datetime.ts`.

---

## 3. Security rules

Non-negotiable:

- **No secrets in source, in git, or in the browser bundle.** Read config only
  through `@/lib/env/server` (secret-bearing, `server-only`) or
  `@/lib/env/client` (public, inlined). Direct `process.env` access is blocked
  by ESLint outside `src/lib/env/`.
- **Authorization is server-side.** Hiding UI is a courtesy, not a control.
- **RLS is defence in depth**, not a replacement for application checks. Both.
- **Validate every input with Zod** at the boundary.
- **Never log** medical details, full addresses, telephone numbers, email
  addresses, names, access tokens, or session material. Use
  `@/lib/logger`, which redacts. `console` is blocked by ESLint.
- **Generic errors to users, detailed logs to the server.** `AuthorizationError`
  and `NotFoundError` intentionally share a user message so record existence
  cannot be probed.
- **Webhooks**: verify the signature before parsing, and make processing
  idempotent.
- **No sensitive values in URLs**, query strings, or analytics.
- Use the service-role Supabase key only in code paths that have already
  performed their own authorization check.

---

## 4. Project boundaries

**In scope:** appointment coordination, transportation arrangement, optional
non-medical companionship, manual operations scheduling, audit trail.

**Out of scope — do not build without an explicit decision:**

- AI medical advice, diagnosis, triage, or symptom interpretation
- Medication management or reminders
- Insurance claims, eligibility, or billing
- EHR / EMR integration
- Live GPS or driver tracking
- Automatic caregiver matching (assignment is manual, by operations)
- Caregiver payouts
- Storing clinical data of any kind

**Data minimisation is a design rule.** Before adding a field, justify it in
[PRIVACY-DATA-MAP.md](PRIVACY-DATA-MAP.md). Full date of birth is deliberately
not collected — see [docs/DECISIONS.md](docs/DECISIONS.md) #1.

**Ask before:** a major architectural change, a new paid dependency, adding a
field that increases sensitivity, or anything on the out-of-scope list.

---

## 5. Definition of done

A change is done when **all** of these hold:

- [ ] `pnpm lint` passes with no warnings
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes, and new behaviour has tests
- [ ] Mutations authenticate, authorize, validate, and audit
- [ ] Authorization is tested for the *negative* case — the wrong family, the
      wrong caregiver, the non-admin
- [ ] No secret, token, or personal data appears in a log, URL, or the client bundle
- [ ] User-facing errors are generic; server logs carry the detail
- [ ] New UI is keyboard reachable, has visible focus, and meets contrast
- [ ] High-impact actions ask for confirmation
- [ ] Any new data field is recorded in PRIVACY-DATA-MAP.md
- [ ] Seed and test data is obviously fictional
- [ ] Docs updated if conventions, commands, or the data model changed

---

## 6. Prohibited shortcuts

Never do any of these, including "temporarily", to make something pass:

- `@ts-ignore`, `@ts-expect-error` without a written justification, `any` to
  silence a type error, or loosening `tsconfig.json` strictness
- `eslint-disable` on a boundary or security rule
- Disabling, bypassing, or "stubbing out" authentication, authorization, RLS,
  or Zod validation
- Skipping or deleting a failing test instead of fixing the cause
- Committing a real credential, even to a private repository
- Using real patient, health, or personal data anywhere — including in seeds,
  fixtures, screenshots, and test names
- Claiming HIPAA compliance in code, copy, comments, or documentation
- Logging a whole record "just for debugging"
- Adding an abstraction for a single caller

If a rule genuinely blocks correct work, raise it and change the rule
deliberately. Do not route around it.
