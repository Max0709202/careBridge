import {
  WebhookSignatureError,
  sign,
  signatureHeader,
  verifySignedPayload,
} from './webhook-signature';

/**
 * The one check standing between a public URL and "this invoice is paid".
 *
 * Held at 100% for the same reason `redaction.ts` is: it is applied in one
 * place, it fails silently when it fails, and the consequence of it failing is
 * not a bug report — it is money.
 */

const SECRET = 'whsec_test_secret';
const NOW = new Date('2026-06-15T12:00:00Z');
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

const BODY = Buffer.from(
  JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' }),
);

function verify(overrides: Partial<Parameters<typeof verifySignedPayload>[0]> = {}) {
  return verifySignedPayload({
    rawBody: BODY,
    signatureHeader: signatureHeader({
      rawBody: BODY,
      secret: SECRET,
      timestamp: TIMESTAMP,
    }),
    secret: SECRET,
    now: NOW,
    ...overrides,
  });
}

describe('a genuine callback', () => {
  it('verifies', () => {
    expect(() => verify()).not.toThrow();
  });

  it('accepts skew inside the tolerance, in both directions', () => {
    // Two hosts that both run NTP still disagree by seconds. Rejecting that
    // would drop real events; accepting an unbounded offset would make a
    // captured signature replayable forever.
    for (const offset of [-240, 240]) {
      expect(() =>
        verify({
          signatureHeader: signatureHeader({
            rawBody: BODY,
            secret: SECRET,
            timestamp: TIMESTAMP + offset,
          }),
        }),
      ).not.toThrow();
    }
  });

  it('accepts a header carrying several signatures, as it does during rotation', () => {
    const rotated = [
      `t=${TIMESTAMP}`,
      `v1=${sign({ rawBody: BODY, secret: 'the-old-secret', timestamp: TIMESTAMP })}`,
      `v1=${sign({ rawBody: BODY, secret: SECRET, timestamp: TIMESTAMP })}`,
    ].join(',');

    expect(() => verify({ signatureHeader: rotated })).not.toThrow();
  });
});

describe('a callback that must be refused', () => {
  it('has no signature at all', () => {
    expect(() => verify({ signatureHeader: undefined })).toThrow(WebhookSignatureError);
  });

  it('was signed with a different secret', () => {
    expect(() =>
      verify({
        signatureHeader: signatureHeader({
          rawBody: BODY,
          secret: 'not-the-secret',
          timestamp: TIMESTAMP,
        }),
      }),
    ).toThrow(/does not match/);
  });

  it('had its body changed after signing', () => {
    // The attack this exists for: take a real "payment failed" callback and
    // edit one field. The digest is over the bytes, so it stops matching.
    expect(() =>
      verify({ rawBody: Buffer.from(JSON.stringify({ id: 'evt_1', amount: 1 })) }),
    ).toThrow(/does not match/);
  });

  it('is a replay from outside the tolerance', () => {
    expect(() =>
      verify({
        signatureHeader: signatureHeader({
          rawBody: BODY,
          secret: SECRET,
          timestamp: TIMESTAMP - 3_600,
        }),
      }),
    ).toThrow(/tolerance/);
  });

  it.each([
    ['no v1 element', `t=${TIMESTAMP}`],
    [
      'no timestamp',
      `v1=${sign({ rawBody: BODY, secret: SECRET, timestamp: TIMESTAMP })}`,
    ],
    ['nothing parseable', 'garbage'],
    ['an empty header', ''],
    ['a segment with no equals sign', `t=${TIMESTAMP},v1`],
  ])('is malformed: %s', (_label, header) => {
    expect(() => verify({ signatureHeader: header })).toThrow(WebhookSignatureError);
  });

  it('has a timestamp that is not a number', () => {
    expect(() =>
      verify({
        signatureHeader: `t=yesterday,v1=${sign({
          rawBody: BODY,
          secret: SECRET,
          timestamp: TIMESTAMP,
        })}`,
      }),
    ).toThrow(/timestamp/);
  });

  it('carries a signature that is not hex', () => {
    // Reaches the comparison and must be a mismatch, not a crash — `Buffer
    // .from(x, 'hex')` on rubbish produces a short buffer and
    // `timingSafeEqual` throws on a length mismatch.
    expect(() => verify({ signatureHeader: `t=${TIMESTAMP},v1=zzzz` })).toThrow(
      /does not match/,
    );
  });

  it('carries a signature of the right length that is not hex', () => {
    expect(() =>
      verify({ signatureHeader: `t=${TIMESTAMP},v1=${'z'.repeat(64)}` }),
    ).toThrow(/does not match/);
  });
});

describe('the digest itself', () => {
  it('covers the timestamp as well as the body', () => {
    // Otherwise a signature could be lifted onto a fresh timestamp and
    // replayed indefinitely, which is the whole point of binding the two.
    const a = sign({ rawBody: BODY, secret: SECRET, timestamp: TIMESTAMP });
    const b = sign({ rawBody: BODY, secret: SECRET, timestamp: TIMESTAMP + 1 });
    expect(a).not.toEqual(b);
  });

  it('is a stable sha256 hex digest', () => {
    const digest = sign({ rawBody: BODY, secret: SECRET, timestamp: TIMESTAMP });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sign({ rawBody: BODY, secret: SECRET, timestamp: TIMESTAMP })).toEqual(
      digest,
    );
  });
});
