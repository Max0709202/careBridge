import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signed-webhook scheme, shared by both adapters.
 *
 * It is Stripe's — `t=<unix seconds>,v1=<hex hmac of "t.body">` — and the
 * local adapter speaks it too rather than skipping verification. That is the
 * point: the branch that rejects a forged webhook is the same code in
 * development, in the integration suite and in production. A local adapter
 * that waved signatures through would leave the single most security-relevant
 * line in the payment path exercised only by the environment nobody tests in.
 *
 * A webhook is an unauthenticated POST asserting that money moved. Without
 * this, anyone who learns the URL can mark any invoice paid.
 */

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * How far a webhook's timestamp may be from ours.
 *
 * Bounded so a signature captured once cannot be replayed indefinitely. Five
 * minutes is Stripe's own tolerance and is generous enough for clock skew
 * between two hosts that both run NTP.
 */
const TOLERANCE_SECONDS = 5 * 60;

export function verifySignedPayload(input: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
  now: Date;
}): void {
  const { rawBody, signatureHeader, secret, now } = input;

  if (!signatureHeader) {
    throw new WebhookSignatureError('Missing signature header.');
  }

  const parts = new Map<string, string[]>();
  for (const segment of signatureHeader.split(',')) {
    const index = segment.indexOf('=');
    if (index <= 0) continue;
    const key = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    parts.set(key, [...(parts.get(key) ?? []), value]);
  }

  const timestamp = parts.get('t')?.[0];
  const signatures = parts.get('v1') ?? [];

  if (!timestamp || signatures.length === 0) {
    throw new WebhookSignatureError('Malformed signature header.');
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    throw new WebhookSignatureError('Malformed signature timestamp.');
  }

  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - sentAt);
  if (ageSeconds > TOLERANCE_SECONDS) {
    throw new WebhookSignatureError('Signature timestamp outside tolerance.');
  }

  const expected = sign({ rawBody, secret, timestamp: sentAt });

  // Compared against *every* v1 the header carries, because a secret being
  // rotated is signed under both the old and the new one for the overlap.
  const matched = signatures.some((candidate) => equals(candidate, expected));
  if (!matched) {
    throw new WebhookSignatureError('Signature does not match.');
  }
}

/** Also used by the tests and by the local adapter, which signs its own. */
export function sign(input: {
  rawBody: Buffer;
  secret: string;
  timestamp: number;
}): string {
  return createHmac('sha256', input.secret)
    .update(`${input.timestamp}.`)
    .update(input.rawBody)
    .digest('hex');
}

export function signatureHeader(input: {
  rawBody: Buffer;
  secret: string;
  timestamp: number;
}): string {
  return `t=${input.timestamp},v1=${sign(input)}`;
}

/**
 * Constant-time within a length class.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — which leaks only the length of a hex digest that is always 64
 * characters, and never how many leading characters of a forgery were right.
 */
function equals(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    // Non-hex input reaches here. A malformed signature is simply not a match.
    return false;
  }
}
