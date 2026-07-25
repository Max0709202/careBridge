import { describe, expect, it } from "vitest";

import { REDACTED, isSensitiveKey, redact, scrubString } from "@/lib/logger/redact";

/**
 * Redaction is the last line of defence before data leaves the process. These
 * tests exist to make a regression here loud.
 */

describe("isSensitiveKey", () => {
  it("matches regardless of case, separators or surrounding words", () => {
    for (const key of [
      "password",
      "Password",
      "user_password",
      "accessToken",
      "ACCESS_TOKEN",
      "emergencyContactPhone",
      "addressLine1",
      "senior.legalName",
      "coordinationNotes",
      "dateOfBirth",
      "stripe_card_last4",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("leaves operational identifiers alone", () => {
    for (const key of ["id", "serviceRequestId", "status", "role", "createdAt", "timeZone"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe("scrubString", () => {
  it("removes email addresses", () => {
    expect(scrubString("contact ada.fictional@example.test now")).toBe(`contact ${REDACTED} now`);
  });

  it("removes phone numbers in common US formats", () => {
    expect(scrubString("call (555) 010-1234")).toContain(REDACTED);
    expect(scrubString("call 555-010-1234")).toContain(REDACTED);
    expect(scrubString("call +1 555 010 1234")).toContain(REDACTED);
    expect(scrubString("call (555) 010-1234")).not.toContain("010-1234");
  });

  it("removes long digit runs", () => {
    expect(scrubString("ref 123456789012")).toBe(`ref ${REDACTED}`);
  });

  it("truncates very long strings", () => {
    const long = "a".repeat(2000);
    const result = scrubString(long);
    expect(result.length).toBeLessThan(600);
    expect(result).toContain("[truncated]");
  });
});

describe("redact", () => {
  it("replaces values of sensitive keys entirely", () => {
    const result = redact({
      serviceRequestId: "req_123",
      status: "SUBMITTED",
      seniorPhone: "555-010-1234",
      coordinationNotes: "Uses a walker; ring the bell twice",
    }) as Record<string, unknown>;

    expect(result.serviceRequestId).toBe("req_123");
    expect(result.status).toBe("SUBMITTED");
    expect(result.seniorPhone).toBe(REDACTED);
    expect(result.coordinationNotes).toBe(REDACTED);
  });

  it("scrubs identifiers even under an innocuous key name", () => {
    const result = redact({ detail: "reached ada.fictional@example.test" }) as Record<
      string,
      unknown
    >;
    expect(result.detail).toBe(`reached ${REDACTED}`);
  });

  it("redacts nested structures", () => {
    const result = redact({
      request: { id: "req_1", clinic: { streetAddress: "1 Fictional Way" } },
    }) as { request: { id: string; clinic: { streetAddress: string } } };

    expect(result.request.id).toBe("req_1");
    expect(result.request.clinic.streetAddress).toBe(REDACTED);
  });

  it("caps depth so a deep object graph cannot be dumped", () => {
    const deep = { a: { b: { c: { d: { e: { f: "too far" } } } } } };
    expect(JSON.stringify(redact(deep))).toContain("[depth-limit]");
  });

  it("caps array length", () => {
    const result = redact(Array.from({ length: 50 }, (_, index) => index)) as unknown[];
    expect(result).toHaveLength(21);
    expect(result.at(-1)).toBe("[+30 more]");
  });

  it("keeps errors useful but trims the stack", () => {
    const error = new Error("failed for ada.fictional@example.test");
    const result = redact(error) as { name: string; message: string; stack?: string };

    expect(result.name).toBe("Error");
    expect(result.message).toBe(`failed for ${REDACTED}`);
    expect(result.stack?.split("\n").length ?? 0).toBeLessThanOrEqual(5);
  });

  it("passes primitives and dates through predictably", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(new Date("2025-01-01T00:00:00.000Z"))).toBe("2025-01-01T00:00:00.000Z");
  });
});
