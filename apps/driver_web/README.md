# CareBridge driver app — web

The driver app from `apps/driver_app/` (Flutter), rebuilt for the browser in
React and TypeScript. It talks to the same API (`apps/api`) with the same
endpoints and rules, and it serves the same URLs (`/sign-in`, `/today`,
`/documents`, `/job/:rideId`).

```
pnpm install --filter @carebridge/driver-web
pnpm --filter @carebridge/driver-web dev        # http://localhost:5174, proxies /api → :3000
pnpm --filter @carebridge/driver-web test       # vitest: domain, API client, location service, whole-app flows
pnpm --filter @carebridge/driver-web build      # → apps/driver_web/dist
pnpm --filter @carebridge/driver-web gen:api    # regenerate src/api/schema.d.ts from packages/contracts/openapi.json
```

The dev server proxies `/api` to `http://localhost:3000`. Point it elsewhere
with `CAREBRIDGE_API_PROXY=…`. For an API on another host, build with
`VITE_CAREBRIDGE_API_BASE_URL=…`.

To deploy, run `docker compose up driver-web` (port 8082), or
`docker build -f apps/driver_web/Dockerfile --build-arg UPLOAD_ORIGIN=… .` from
the repo root.

## What a browser cannot do

The Flutter app's own header says why it is native: a browser will not keep
reporting location with the screen off. That is still true. The web version is
for drivers who can't or won't install the app, and it tells them what that
means instead of hiding it:

- **Location is shared only while the page is open and on screen.** The page
  holds a Screen Wake Lock while a ride is being shared, so the phone doesn't
  lock on its own. The ride screen says so, and it says when sharing has paused
  because the page was hidden.
- **The page cannot choose how often the GPS runs.** A browser reports a
  position when it changes. The cadence rule (`src/domain/locationCadence.ts`,
  the same values as the app) decides which fixes are **kept and sent**, so the
  upload rate and the server load match the app. The GPS power draw is up to
  the browser.
- **Battery back-off works only where the Battery Status API exists**
  (Chromium). Elsewhere the level counts as unknown, and the rule treats unknown
  as "no pressure", exactly as the app does when the platform won't answer.
- **Geolocation needs a secure context:** HTTPS, or `http://localhost`. A LAN
  address over plain HTTP gets the "cannot share location here" message.
- **A refused permission can't be requested again.** The page sends the driver
  to the browser's site settings, just as the app sends them to system settings.

## Layout

| Here                           | Flutter counterpart                         |
| ------------------------------ | ------------------------------------------- |
| `src/api/transport.ts`, `failures.ts`, `tokens.ts` | shared with `apps/family_web` (copies)  |
| `src/api/driverApi.ts`         | `lib/data/driver_api.dart`                  |
| `src/api/codec.ts`             | `lib/data/driver_codec.dart`                |
| `src/data/locationQueue.ts`    | `lib/data/location_queue.dart`              |
| `src/domain/*`                 | `lib/domain/*`                              |
| `src/services/positionSource.ts` | `lib/services/position_source.dart`       |
| `src/services/locationService.ts` | `lib/services/location_service.dart`     |
| `src/state/driverStore.ts`     | `lib/state/providers.dart`                  |
| `src/screens/*`                | `lib/features/*`                            |
| `src/styles.css`               | `lib/app/theme.dart`                        |

## Rules carried over, not re-decided

- **The work list polls every 20 s, from the store rather than a screen.** It
  also re-reads as soon as the page comes back on screen. Following the active
  ride is a side effect of reading the list, so leaving the ride screen doesn't
  stop the family's map.
- **Advancing a ride is idempotency-keyed.** A retry on a patchy connection and
  a double tap are the same thing.
- **Location stops the moment the ride leaves a sharing state**, and the queue
  is thrown away rather than flushed. Changing to a different ride clears the
  old ride's queue.
- **The queue is bounded (720), drops the oldest, prunes anything older than
  6 h, and is kept only in memory.**
- **The no-show waits out the kerbside countdown and asks for confirmation.** It
  is styled apart from the main button.
- **Document bytes go straight to storage on the pre-signed URL**, with exactly
  the signed headers, no `Authorization`, and `credentials: 'omit'`. The server
  then checks storage itself.
- **A 404 from `/driver/me` is a sentence** ("not on an operator's roster"),
  not an error.

## Where the web app differs from the Flutter app

- **A failed location upload is retried every 15 s and on `online`**, not only
  when the next fix arrives, because a browser sends nothing while the car is
  stopped.
- **Speed is derived from consecutive fixes** when the browser doesn't report
  it, so a stopped car still backs off to the stopped cadence.
- **Sign-in accepts a two-factor code**, as the family web app does. The API
  requires `mfaCode` once 2FA is on.
- **Sign-out calls `/auth/logout` with the refresh token before clearing it.**
  The Flutter app clears the tokens first and then calls `/auth/logout-all`,
  which can't authenticate by then, so the server-side logout never runs.
- **Documents can be PDFs as well as photos.** The API accepts JPEG, PNG, HEIC
  and PDF. Photos the browser can decode are re-encoded as a JPEG with its
  longest edge capped at 2400 px, as the app's picker does.
- **Screens with pull-to-refresh have a Refresh button instead.**
- **The field-test recorder (`lib/services/field_recorder.dart`) is not
  ported.** It is off in every normal build and exists to measure a native
  device's battery drain.

## Deployment notes

- Its own origin, like the ops console. The tokens use the same
  `carebridge.accessToken` / `carebridge.refreshToken` keys as the other web
  builds, which only works because the origin is separate.
- `infrastructure/nginx/driver-security-headers.conf` replaces the shared
  headers file in this image. It allows `geolocation=(self)` and
  `screen-wake-lock=(self)`, and adds the storage origin (`UPLOAD_ORIGIN`) to
  `connect-src`.
- The storage bucket's CORS policy must allow `PUT` from the driver origin. On
  the local stack, filesystem storage is served by the API under
  `PUBLIC_APP_URL`, and the API's `CORS_ORIGINS` must include the driver origin
  (it defaults to `*` in `docker-compose.yml`).
