import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP, and RFC 4648 base32 to carry the shared secret.
 *
 * Written out rather than pulled from a package because it is forty lines of
 * arithmetic specified by an RFC that has not changed since 2011, it has
 * published test vectors we can assert against, and an authentication
 * primitive is a poor place to inherit a supply chain. Pure: no I/O, no clock
 * of its own — the time step is passed in, which is what makes the drift
 * window testable.
 */

export interface TotpOptions {
  /** Seconds per step. 30 is what every authenticator app assumes. */
  stepSeconds?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

const DEFAULTS = {
  stepSeconds: 30,
  digits: 6,
  // SHA-1 is not a security weakness here — HMAC-SHA1 is unbroken, and it is
  // what Google Authenticator and its imitators actually implement. Choosing
  // SHA-256 would produce codes half the ecosystem cannot generate.
  algorithm: 'sha1' as const,
};

export function generateTotp(
  secret: Buffer,
  atMs: number,
  options: TotpOptions = {},
): string {
  const { stepSeconds, digits, algorithm } = { ...DEFAULTS, ...options };
  const counter = Math.floor(atMs / 1000 / stepSeconds);

  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(algorithm, secret).update(counterBytes).digest();

  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks
  // where in the digest to read four bytes from.
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Checks a submitted code against the current step and `window` steps either
 * side.
 *
 * A window of 1 — thirty seconds of tolerance in each direction — is the
 * usual compromise. Zero rejects anyone whose phone clock is a few seconds
 * out, which in practice is a support ticket; large windows multiply the
 * number of codes valid at any instant, which is what an online guessing
 * attack is counting on.
 *
 * The comparison is constant-time. A six-digit code compared with `===` leaks
 * a prefix-match timing signal, and six digits is a small enough space that
 * the leak is worth something.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  atMs: number,
  options: TotpOptions & { window?: number } = {},
): boolean {
  const submitted = code.replace(/\s/g, '');
  const digits = options.digits ?? DEFAULTS.digits;
  if (!new RegExp(`^\\d{${digits}}$`).test(submitted)) return false;

  const window = options.window ?? 1;
  const stepMs = (options.stepSeconds ?? DEFAULTS.stepSeconds) * 1000;

  let matched = false;
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = generateTotp(secret, atMs + drift * stepMs, options);
    // No early return: the loop runs to completion regardless, so the time
    // taken does not reveal *which* step matched.
    matched = constantTimeEquals(expected, submitted) || matched;
  }
  return matched;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ─── base32 (RFC 4648, no padding) ──────────────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The form a secret takes in an `otpauth://` URI and in a manual-entry field. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 0x1f];

  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The label carries the account's email, which is unavoidable — it is what
 * distinguishes two CareBridge entries in a list of thirty. It never leaves
 * the response to the enrolling user's own request, and it is not logged.
 */
export function totpUri(options: {
  issuer: string;
  accountName: string;
  secret: Buffer;
}): string {
  const label = encodeURIComponent(`${options.issuer}:${options.accountName}`);
  const params = new URLSearchParams({
    secret: base32Encode(options.secret),
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULTS.digits),
    period: String(DEFAULTS.stepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
