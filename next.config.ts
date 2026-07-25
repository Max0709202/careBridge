import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response.
 *
 * NOTE: Content-Security-Policy is intentionally NOT set here. A useful CSP for
 * Next.js needs a per-request nonce, which requires middleware. Middleware is
 * introduced in Phase 2 alongside Supabase session handling, and the CSP is
 * added there so there is exactly one place that owns request-scoped headers.
 * Tracked in SECURITY.md -> "Known gaps".
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    // Only meaningful over HTTPS; browsers ignore it on plain-http localhost.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework version.
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
