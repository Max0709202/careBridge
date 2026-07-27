import { describe, expect, it } from "vitest";

import { buildCsp } from "@/server/security/csp";

describe("buildCsp", () => {
  it("blocks cross-origin scripts while allowing same-origin and inline", () => {
    const csp = buildCsp({ appEnv: "production" });
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("default-src 'self'");
  });

  it("forbids framing and restricts base/form/object", () => {
    const csp = buildCsp({ appEnv: "production" });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("allows eval and websockets only in development", () => {
    const dev = buildCsp({ appEnv: "development" });
    const prod = buildCsp({ appEnv: "production" });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("adds upgrade-insecure-requests only in production (never on http dev/test)", () => {
    expect(buildCsp({ appEnv: "production" })).toContain("upgrade-insecure-requests");
    expect(buildCsp({ appEnv: "test" })).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ appEnv: "development" })).not.toContain("upgrade-insecure-requests");
  });

  it("widens connect-src to the Supabase origin and its websocket", () => {
    const csp = buildCsp({ appEnv: "production", supabaseUrl: "https://abc.supabase.co" });
    expect(csp).toContain("https://abc.supabase.co");
    expect(csp).toContain("wss://abc.supabase.co");
  });

  it("survives a malformed Supabase URL without throwing", () => {
    expect(() => buildCsp({ appEnv: "production", supabaseUrl: "not a url" })).not.toThrow();
  });
});
