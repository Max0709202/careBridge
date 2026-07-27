/**
 * Content-Security-Policy construction.
 *
 * Deferred from Phase 1 because CSP needs request-scoped handling, which needs
 * middleware/proxy (see docs/DECISIONS.md #3).
 *
 * Script policy: `'self' 'unsafe-inline'`. This blocks the biggest XSS vector —
 * loading script from another origin — while permitting the same-origin and
 * inline scripts that Next emits on statically-rendered pages. A nonce +
 * `strict-dynamic` policy is stronger, but Next only stamps a nonce on
 * dynamically rendered pages, so it cannot cover the static marketing pages;
 * tightening to it (and making the relevant pages dynamic) is tracked as Phase
 * 7 hardening in SECURITY.md. `connect-src` is widened to the Supabase origin
 * so the browser client can reach Auth and the data API.
 *
 * Pure and unit tested (tests/unit/csp.test.ts).
 */
export function buildCsp(options: { appEnv: string; supabaseUrl?: string | undefined }): string {
  const { appEnv, supabaseUrl } = options;
  const isDev = appEnv === "development";

  const connect = new Set<string>(["'self'"]);
  if (supabaseUrl) {
    try {
      const { origin, host } = new URL(supabaseUrl);
      connect.add(origin);
      connect.add(`wss://${host}`); // realtime websocket
      if (isDev) connect.add(`ws://${host}`);
    } catch {
      // Malformed URL: connect-src simply stays 'self'.
    }
  }
  if (isDev) connect.add("ws:"); // local HMR socket

  const scriptSrc = ["'self'", "'unsafe-inline'", isDev ? "'unsafe-eval'" : ""]
    .filter(Boolean)
    .join(" ");

  const directives: Array<[string, string]> = [
    ["default-src", "'self'"],
    ["script-src", scriptSrc],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self'"],
    ["connect-src", [...connect].join(" ")],
    ["frame-ancestors", "'none'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["manifest-src", "'self'"],
  ];

  // Only in real production (served over HTTPS). Emitting this against a
  // plain-http origin (local dev, e2e) would upgrade subresources to https and
  // break script loading.
  if (appEnv === "production") directives.push(["upgrade-insecure-requests", ""]);

  return directives.map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}
