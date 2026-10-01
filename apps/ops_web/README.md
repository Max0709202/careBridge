# CareBridge ops console — web

The dispatch console from `apps/ops_console/` (Flutter), rebuilt for the browser
in React and TypeScript. It talks to the same API (`apps/api`) with the same
endpoints and rules, and it serves the same URLs (`/sign-in`, `/organizations`,
`/queue`, `/roster`, `/fleet`, `/seats`, `/billing`, `/admin`, `/admin/audit`,
`/admin/flags`, `/admin/refunds`).

```
pnpm install --filter @carebridge/ops-web
pnpm --filter @carebridge/ops-web dev        # http://localhost:5175, proxies /api → :3000
pnpm --filter @carebridge/ops-web test       # vitest: domain rules, codec, whole-app flows
pnpm --filter @carebridge/ops-web build      # → apps/ops_web/dist
pnpm --filter @carebridge/ops-web gen:api    # regenerate src/api/schema.d.ts from packages/contracts/openapi.json
```

The dev server proxies `/api` to `http://localhost:3000`. Point it elsewhere
with `CAREBRIDGE_API_PROXY=…`. For an API on another host, build with
`VITE_CAREBRIDGE_API_BASE_URL=…`.

To deploy, run `docker compose up ops-web` (port 8083), or
`docker build -f apps/ops_web/Dockerfile .` from the repo root. It is a drop-in
for `Dockerfile.ops`: the same nginx config, the same same-origin `/api` proxy
and the same Content-Security-Policy, on its own origin.

## Layout

| Here                               | Flutter counterpart                                  |
| ---------------------------------- | ---------------------------------------------------- |
| `src/api/transport.ts`, `failures.ts`, `tokens.ts`, `ids.ts` | shared with `apps/family_web` and `apps/driver_web` (copies) |
| `src/messaging/` — conversations, relay calls, the messaging socket, browser alerts and Web Push (ADR-0014) | shared with `apps/family_web` and `apps/driver_web` (copies — the whole folder, and `test/messaging.test.ts`) |
| `src/screens/messages/` | the console's Messages tab, call bar and calls-and-alerts sheet |
| `public/sw.js` | the service worker, for background notifications only |
| `src/api/opsApi.ts`                | `lib/data/ops_api.dart`                              |
| `src/api/codec.ts`                 | `ops_codec.dart`, `admin_codec.dart`, `billing_codec.dart` |
| `src/domain/*`                     | `lib/domain/*`                                       |
| `src/core/money.ts`                | `lib/core/money.dart`                                |
| `src/state/opsStore.ts`            | `lib/state/providers.dart`                           |
| `src/App.tsx`                      | `lib/app/router.dart`                                |
| `src/screens/ConsoleShell.tsx`     | `lib/app/shell.dart`                                 |
| `src/screens/*`, `src/screens/admin/*` | `lib/features/*`                                 |
| `src/components/pills.tsx`, `ui.tsx` | `lib/widgets/common.dart`                          |
| `src/styles.css`                   | `lib/app/theme.dart`                                 |

`OpsStore` replaces Riverpod's `FutureProvider.family` + `ref.invalidate` with a
keyed resource cache. The keys carry the organisation id exactly where the
provider families did, and `invalidateOperational` / `invalidateBilling` refresh
the same groups as `refreshOperationalState` / `refreshBillingState`.

## Rules carried over, not re-decided

- **The operator is always a choice, never a default**, and it is named in the
  title bar on every console screen.
- **The queue polls every 10 s while it is on screen**, and re-reads as soon as
  the tab comes back. It is rendered in the server's order, never re-sorted.
- **A stranded ride is called out as a phone call**, with every reason counted
  across candidates and the remedy where there is one.
- **Ineligible candidates are listed, not hidden**, and cannot be chosen. A
  reassignment will not send without a reason.
- **Assign, add vehicle, subscribe, attach card and refund are
  idempotency-keyed.**
- **Assigning refreshes the queue and the roster together**; a billing action
  refreshes account, invoices and seats together.
- **Shift is a dispatcher's control; status is an owner's or admin's.**
  Suspending or offboarding needs a reason. There is no edge from `invited` to
  `approved`.
- **Opening a document is a deliberate click** that mints a short-lived link in
  a new tab. A rejection needs its reason first.
- **No card number is ever asked for.** The dialog takes a processor token,
  as the Flutter console does, until the processor's card element is wired up.
- **Unknown values are dropped or kept by the same per-field rule as the Dart
  codecs**: never so that a driver looks more available, an invoice more
  settled, or a refund more finished than it is. Audit rows are always shown.
- **The Administration door appears only after a successful platform read**,
  and a failure hides it rather than showing a door that then 404s. Narrowing a
  flag is confirmed first, and `confirmNarrowing` is sent only when it was.
- **Urgency and status are never colour alone.** Every pill has an icon and a
  word, and an accessible name ("Urgency: Overdue").

## Where the web app differs from the Flutter app

These are fixes for gaps in the Flutter console, not new product decisions:

- **"Switch operator" works.** The Flutter router redirects `/organizations`
  back to `/queue` whenever an operator is chosen, so the button never reaches
  the picker. Here it clears the choice first.
- **A revoked membership goes back to the picker.** The Flutter shell's comment
  says it does; the code only blanks the title.
- **The chosen operator survives a reload of the tab** (sessionStorage, per tab,
  cleared on sign-out). The Flutter build keeps it only in memory, so a reload
  mid-shift drops the dispatcher back at the picker. A second tab is still a
  second choice.
- **Sign-in accepts a two-factor code**, as the family and driver web apps do.
- **Sign-out calls `/auth/logout` with the refresh token before clearing it.**
  The Flutter console clears the tokens first and then calls
  `/auth/logout-all`, which can no longer authenticate.
- **A failed re-read keeps what was on screen**, with a "could not refresh"
  banner, instead of replacing a working queue with an error because one poll
  timed out.
- **Refund amounts are parsed as decimal text**, not through a float.
- **Screens that had pull-to-refresh have a Refresh button.**

## Not ported

- `OpsApi.addDriver` exists in the Flutter client but no Flutter screen calls
  it, so there is no "add driver" form here either.
