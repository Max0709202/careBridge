# CareBridge family app — web

The family app from `lib/` (Flutter), rebuilt for the browser in React and
TypeScript. It talks to the same API (`apps/api`) with the same endpoints and
the same rules, and it serves the same URLs. A link that works in one works in
the other.

```
pnpm install --filter @carebridge/family-web
pnpm --filter @carebridge/family-web dev        # http://localhost:5173, proxies /api → :3000
pnpm --filter @carebridge/family-web test       # vitest: domain, codec, transport, whole-app flows
pnpm --filter @carebridge/family-web build      # → apps/family_web/dist
pnpm --filter @carebridge/family-web gen:api    # regenerate src/api/schema.d.ts from packages/contracts/openapi.json
```

The dev server proxies `/api` (including the tracking WebSocket) to
`http://localhost:3000`. Point it elsewhere with `CAREBRIDGE_API_PROXY=…`.
The bundle calls a relative `/api/v1`, exactly as the Flutter web build does.
For an API on another host, build with `VITE_CAREBRIDGE_API_BASE_URL=…`.

To deploy, run `docker build -f apps/family_web/Dockerfile .` from the repo root.
It is a drop-in for `Dockerfile.web`: the same nginx config, the same
Content-Security-Policy (`script-src 'self'`, `connect-src 'self'`, bundled
fonts), and the same same-origin API proxy.

## Layout

| Here                       | Flutter counterpart                       |
| -------------------------- | ----------------------------------------- |
| `src/api/transport.ts`     | `carebridge_client/…/api_transport.dart`  |
| `src/api/failures.ts`      | `failures.dart`, `error_mapping.dart`     |
| `src/api/careApi.ts`       | `lib/data/care_api.dart`                  |
| `src/api/codec.ts`         | `care_codec.dart`, `billing_codec.dart`   |
| `src/api/trackingSocket.ts`| `lib/data/tracking_socket.dart`           |
| `src/api/schema.d.ts`      | `packages/dart/carebridge_api` (generated)|
| `src/state/careStore.ts`   | `CareNotifier` in `lib/state/providers.dart` |
| `src/state/careState.ts`   | `lib/data/care_state.dart`                |
| `src/domain/*`             | `lib/domain/*`                            |
| `src/core/*`               | `lib/core/*`                              |
| `src/screens/*`            | `lib/features/*`                          |
| `src/styles.css`           | `lib/app/theme.dart`                      |

## Rules carried over, not re-decided

- **One transport owns refresh.** A 401 gets one refresh-and-retry, and the
  retry reuses the same `Idempotency-Key`. A failed refresh clears the session.
  In the browser, concurrent 401s also share a single refresh, so a single-use
  refresh token is never presented twice.
- **Mutations return the whole snapshot**, and the store adopts it. The server
  decides what a change implies.
- **The store polls every 4 s, and only while a preview trip is running.**
  Position arrives by push over Socket.IO. The token goes in the handshake
  `auth`, never in the query string.
- **Positions are aged against `capturedAt`.** The screen warns after 45 s and
  stops showing a position after 2 min.
- **"Not found" and "not yours" read identically**, both in the error message
  and on screen.
- **Controls a grant does not allow are hidden, not refused.** The server
  re-checks every request.
- **Money is integer cents**, rounded half away from zero, as on the server.
- **Tokens use the same storage keys as the Flutter web build**
  (`carebridge.accessToken` / `carebridge.refreshToken`). Storage failures
  degrade to "signed out" instead of throwing.

## Where the web app differs from the Flutter app

These are fixes for gaps in the Flutter app, not new product decisions:

- **Sign-in accepts a two-factor code.** The API requires `mfaCode` once 2FA is
  on, and the Flutter sign-in screen has no field for it.
- **`/verify-email`, `/reset-password` and `/forgot-password` exist.** The API
  emails links to the first two on this origin, and the Flutter router sends
  both to sign-in, which drops the token.
- **A signed-out invitation link survives sign-in.** The guard keeps the target
  in `?next=`, which is always an in-app path and never an open redirect.
- **Sign-in, register and ride cancellation wait for the server** before moving
  on. The Flutter versions don't await the call, so their errors are never shown.
- **Screens that had pull-to-refresh have a Refresh button.** The Flutter
  dashboard's pull-to-refresh did nothing.
- **Wide windows get a side rail** instead of a bottom bar.
- **The deletion export can also be downloaded as a file**, not only copied.

## Known contract gap

`SaveClinicDto` accepts and stores `entranceNotes` and `operatingNotes`, but
they are declared without `@ApiPropertyOptional`, so they are missing from
`packages/contracts/openapi.json` and from the generated types. The web client
sends `entranceNotes` the same way the Flutter app does. If the decorators are
added and the contract is re-emitted, `pnpm gen:api` picks the fields up.

## Messages and calls

Conversations with dispatch and relay calls (ADR-0014). `src/messaging/` is
shared with `apps/ops_web` and `apps/driver_web` — the whole folder is copied,
like `src/api/transport.ts`, so a change goes into all three. The screens are
in `src/screens/messages/`; conversations appear at the top of Updates, a
ride's thread opens from the ride, and `public/sw.js` shows background
notifications when they are switched on in Settings → Calls and messages.
