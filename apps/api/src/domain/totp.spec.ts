import {
  base32Decode,
  base32Encode,
  constantTimeEquals,
  generateTotp,
  totpUri,
  verifyTotp,
} from './totp';

/**
 * The RFC 6238 Appendix B secret: the ASCII string "12345678901234567890".
 * Every vector below is taken from that appendix, which is the point of using
 * them — they check this implementation against the specification rather than
 * against itself.
 */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP, against the RFC 6238 vectors', () => {
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
    [20_000_000_000, '353130'],
  ])('at t=%i produces %s', (seconds, expected) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000)).toBe(expected);
  });
});

describe('TOTP verification', () => {
  const now = 1_700_000_000_000;

  it('accepts the code for the current step', () => {
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now), now)).toBe(true);
  });

  it('tolerates a phone clock one step out, in either direction', () => {
    // Zero tolerance turns a slightly wrong clock into a support ticket.
    const past = generateTotp(RFC_SECRET, now - 30_000);
    const future = generateTotp(RFC_SECRET, now + 30_000);

    expect(verifyTotp(RFC_SECRET, past, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, future, now)).toBe(true);
  });

  it('rejects a code from outside the window', () => {
    const stale = generateTotp(RFC_SECRET, now - 120_000);
    expect(verifyTotp(RFC_SECRET, stale, now)).toBe(false);
  });

  it('rejects a code produced by a different secret', () => {
    const other = Buffer.from('09876543210987654321', 'ascii');
    expect(verifyTotp(RFC_SECRET, generateTotp(other, now), now)).toBe(false);
  });

  it('rejects anything that is not six digits, without hashing it', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 ', '-12345']) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toBe(false);
    }
  });

  it('ignores the spaces an authenticator app displays', () => {
    const code = generateTotp(RFC_SECRET, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET, spaced, now)).toBe(true);
  });
});

describe('base32', () => {
  it('matches the RFC 4648 test vectors', () => {
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Encode(Buffer.from('fo'))).toBe('MZXQ');
    expect(base32Encode(Buffer.from('foo'))).toBe('MZXW6');
    expect(base32Encode(Buffer.from('foob'))).toBe('MZXW6YQ');
    expect(base32Encode(Buffer.from('fooba'))).toBe('MZXW6YTB');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('round-trips arbitrary bytes', () => {
    const secret = Buffer.from(Array.from({ length: 20 }, (_, i) => (i * 37) % 256));
    expect(base32Decode(base32Encode(secret))).toEqual(secret);
  });

  it('tolerates padding, spaces and lower case, as typed by a human', () => {
    expect(base32Decode('mzxw 6ytb oi==')).toEqual(Buffer.from('foobar'));
  });

  it('rejects a character outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow(/base32/);
  });
});

describe('otpauth URI', () => {
  it('carries everything an authenticator app needs to reproduce our codes', () => {
    const uri = totpUri({
      issuer: 'CareBridge',
      accountName: 'someone@example.com',
      secret: RFC_SECRET,
    });

    expect(uri).toMatch(/^otpauth:\/\/totp\/CareBridge%3Asomeone%40example.com\?/);
    expect(uri).toContain(`secret=${base32Encode(RFC_SECRET)}`);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('compares codes of different lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch, and a submitted code is
    // whatever the user typed. The length check has to come first or a
    // four-digit entry is a 500 rather than a rejection.
    expect(constantTimeEquals('123456', '1234')).toBe(false);
    expect(constantTimeEquals('123456', '123456')).toBe(true);
    expect(constantTimeEquals('123456', '654321')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
