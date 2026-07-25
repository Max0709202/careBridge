/**
 * Log redaction.
 *
 * CareBridge handles care-coordination data about identifiable elderly people.
 * Logs are the easiest place for that data to escape into systems that were
 * never designed to hold it (log aggregators, error trackers, terminal
 * scrollback, CI output). The defence is layered:
 *
 *   1. Key-based redaction  - any key whose name suggests sensitive content.
 *   2. Value-based scrubbing - anything that *looks* like an email address,
 *      phone number, or long digit run, wherever it appears.
 *   3. Structural limits    - depth, breadth and string length caps, so a
 *      whole database row can never be dumped even by accident.
 *
 * These functions are pure and unit tested; see tests/unit/logger-redact.test.ts.
 */

export const REDACTED = "[redacted]";

/**
 * Substrings that mark a key as sensitive. Matching is case-insensitive and by
 * substring, so `emergencyContactPhone` is caught by `phone`.
 *
 * When in doubt, add the key. A missing log line costs a debugging session; a
 * leaked one costs a person's privacy.
 */
const SENSITIVE_KEY_PATTERNS = [
  // Credentials and session material
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "cookie",
  "session",
  "credential",
  "signature",
  "jwt",
  "bearer",
  // Direct identifiers
  "ssn",
  "socialsecurity",
  "dob",
  "dateofbirth",
  "birthdate",
  "legalname",
  "firstname",
  "lastname",
  "fullname",
  "email",
  "phone",
  "telephone",
  "mobile",
  // Location
  "address",
  "street",
  "addressline",
  "postal",
  "zip",
  "latitude",
  "longitude",
  "geo",
  // Care-coordination content that may describe a person's health or home
  "note",
  "notes",
  "diagnosis",
  "medication",
  "medical",
  "clinical",
  "condition",
  "mobilityneeds",
  "accessibilityneeds",
  "incidentdescription",
  "reason",
  // Payment instruments
  "card",
  "cvc",
  "iban",
  "account_number",
  "accountnumber",
];

/** Caps that keep a stray object from becoming a data dump. */
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 512;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// North American style numbers, with or without separators and country code.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
// Any run of 9+ digits: account numbers, SSNs without dashes, long ids.
const LONG_DIGIT_RE = /\b\d{9,}\b/g;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PATTERNS.some((pattern) =>
    normalized.includes(pattern.replace(/[^a-z0-9]/g, "")),
  );
}

/** Scrubs identifier-shaped substrings out of free text. */
export function scrubString(value: string): string {
  const truncated =
    value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;

  // Order matters. Long contiguous digit runs are scrubbed BEFORE the phone
  // pattern: otherwise the phone pattern eats the front of a long run (e.g. an
  // account number) and leaves a stray trailing digit behind.
  return truncated
    .replace(EMAIL_RE, REDACTED)
    .replace(LONG_DIGIT_RE, REDACTED)
    .replace(PHONE_RE, REDACTED);
}

/**
 * Returns a structurally-similar copy of `value` with sensitive content
 * removed. Never throws: redaction failing must not break the caller.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return "[omitted]";

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      // Stacks can contain interpolated values; keep the top frames only.
      stack: value.stack ? scrubString(value.stack.split("\n").slice(0, 5).join("\n")) : undefined,
    };
  }

  if (depth >= MAX_DEPTH) return "[depth-limit]";

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    }
    return items;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);

    for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1);
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      out["…"] = `[+${entries.length - MAX_OBJECT_KEYS} more keys]`;
    }
    return out;
  }

  return "[unserializable]";
}

/** Convenience wrapper for the structured metadata bag on a log line. */
export function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redact(metadata) as Record<string, unknown>;
}
