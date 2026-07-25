import { describe, expect, it } from "vitest";

import { clientEnvSchema, describeEnvIssues, serverEnvSchema } from "@/lib/env/schema";

describe("clientEnvSchema", () => {
  it("applies safe defaults when nothing is set", () => {
    const result = clientEnvSchema.parse({});
    expect(result.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(result.NEXT_PUBLIC_APP_NAME).toBe("CareBridge");
  });

  it("rejects a malformed app URL rather than silently continuing", () => {
    expect(clientEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: "not-a-url" }).success).toBe(false);
  });

  it("contains no key that looks like a secret", () => {
    // A NEXT_PUBLIC_ value is inlined into the browser bundle. This guards
    // against someone adding a service key here by habit.
    const forbidden = ["SECRET", "SERVICE_ROLE", "PRIVATE", "PASSWORD"];
    for (const key of Object.keys(clientEnvSchema.shape)) {
      for (const marker of forbidden) {
        expect(key.toUpperCase().includes(marker), `${key} must not be public`).toBe(false);
      }
    }
  });
});

describe("serverEnvSchema", () => {
  it("runs with no integration credentials in development", () => {
    const result = serverEnvSchema.safeParse({ APP_ENV: "development" });
    expect(result.success).toBe(true);
  });

  it("requires database credentials in production", () => {
    const result = serverEnvSchema.safeParse({ APP_ENV: "production" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("DATABASE_URL");
      expect(paths).toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });

  it("refuses a Stripe key without a webhook secret", () => {
    const result = serverEnvSchema.safeParse({
      APP_ENV: "production",
      DATABASE_URL: "postgres://fictional",
      SUPABASE_SERVICE_ROLE_KEY: "fictional-key",
      STRIPE_SECRET_KEY: "sk_test_fictional",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.includes("STRIPE_WEBHOOK_SECRET")),
      ).toBe(true);
    }
  });

  it("accepts a fully configured production environment", () => {
    const result = serverEnvSchema.safeParse({
      APP_ENV: "production",
      DATABASE_URL: "postgres://fictional",
      SUPABASE_SERVICE_ROLE_KEY: "fictional-key",
      STRIPE_SECRET_KEY: "sk_test_fictional",
      STRIPE_WEBHOOK_SECRET: "whsec_fictional",
    });
    expect(result.success).toBe(true);
  });

  it("defaults the log level rather than leaving it undefined", () => {
    expect(serverEnvSchema.parse({}).LOG_LEVEL).toBe("info");
  });
});

describe("describeEnvIssues", () => {
  it("reports variable names and rules but never values", () => {
    const result = serverEnvSchema.safeParse({ APP_ENV: "not-a-tier" });
    expect(result.success).toBe(false);
    if (result.success) return;

    const description = describeEnvIssues(result.error);
    expect(description).toContain("APP_ENV");
    expect(description).not.toContain("not-a-tier");
  });
});
