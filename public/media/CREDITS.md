# Media credits

Marketing imagery for the public pages. All assets are royalty-free and were
downloaded into `public/` so they are served **same-origin** — nothing is
hot-linked at runtime, which keeps the strict Content-Security-Policy
(`img-src 'self'`, `media-src` via `default-src 'self'`) intact and avoids
leaking to a third party that a visitor came to CareBridge.

None of these depict a real CareBridge client. They are generic stock and carry
no personal or health data.

| File                 | Source  | License                        | Subject                                   |
| -------------------- | ------- | ------------------------------ | ----------------------------------------- |
| `hero.jpg`           | Unsplash| Unsplash License (no attribution required) | A companion walking an older adult outdoors at dusk |
| `transport.jpg`      | Unsplash| Unsplash License               | Driver at the wheel at dusk               |
| `journey.mp4`        | Pexels  | Pexels License (no attribution required)   | Cars flowing on an open road (854671, SD 960×540) |
| `journey-poster.jpg` | Pexels  | Pexels License                 | Poster still for `journey.mp4`            |

To replace any of these, drop a file of the same name here. Keep it same-origin
(no external `src` / no CSP relaxation) and keep the subject non-clinical —
CareBridge is explicitly not a medical service.
