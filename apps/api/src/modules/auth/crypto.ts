import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Token minting, digesting and secret encryption, in one file so the choices
 * are visible next to each other rather than repeated per call site.
 */

/**
 * 32 bytes of CSPRNG output, base64url.
 *
 * 256 bits is far past the point where guessing matters; the reason not to
 * economise is that these values appear in URLs where truncation looks
 * harmless and is not.
 */
export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are stored only as a digest.
 *
 * SHA-256 rather than argon2 on purpose: these are 32 random bytes, not a
 * human-chosen secret, so there is no dictionary to slow an attacker down
 * against — and this runs on every token presentation, where argon2's cost
 * would buy nothing and be paid constantly.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ─── secret encryption ──────────────────────────────────────────────────────

/**
 * Byte fields are `Uint8Array`, not `Buffer`, because that is what Prisma's
 * `Bytes` columns are typed as. Converting at this boundary rather than at
 * every call site keeps the `Buffer` vs `Uint8Array` distinction — which is a
 * TypeScript detail, not a cryptographic one — out of the services.
 */
export interface SealedSecret {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
}

/**
 * Copies into a plain `ArrayBuffer`. Node's `Buffer` is backed by a shared
 * pool, which types as `ArrayBufferLike` and which Prisma's `Bytes` columns
 * will not accept — and the copy is the honest fix, because handing a slice of
 * a shared pool to a storage layer is how one secret ends up carrying bytes of
 * another.
 */
function detach(value: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.length));
  copy.set(value);
  return copy;
}

/**
 * AES-256-GCM under a key that lives in Secrets Manager, not in this database.
 *
 * GCM rather than CBC because it authenticates: without the tag, a row an
 * attacker can write is a row they can tamper with, and a TOTP secret they
 * control is a second factor they own. A fresh 96-bit IV per seal — the
 * standard GCM size, and never reused, because IV reuse under one key is the
 * failure that breaks GCM completely.
 */
export function sealSecret(plaintext: Buffer, key: Buffer): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: detach(ciphertext),
    iv: detach(iv),
    authTag: detach(cipher.getAuthTag()),
  };
}

/**
 * Throws if the ciphertext or the tag has been altered — which is the point.
 * A caller that swallows this exception has removed the protection.
 */
export function openSecret(sealed: SealedSecret, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext)),
    decipher.final(),
  ]);
}

// ─── recovery codes ─────────────────────────────────────────────────────────

/**
 * The way back in when the phone is gone.
 *
 * Displayed once, at enrolment, and stored only as digests — so support cannot
 * read them out over the phone, which is the social-engineering path that
 * makes recovery codes worse than useless when they are recoverable.
 *
 * Grouped in fours because they are transcribed by hand, often by someone
 * copying them onto paper.
 */
export function mintRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s/g, '');
}
