import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from 'node:crypto';

/**
 * Web Push, by the RFCs, with nothing but `node:crypto`.
 *
 *   - RFC 8291 — the payload is encrypted to the browser's key (aes128gcm,
 *     RFC 8188), so the push service in the middle cannot read it.
 *   - RFC 8292 — VAPID: a short-lived ES256 token proving the push came from
 *     the holder of the key the browser subscribed with.
 *
 * Small enough to read in one sitting, and checked against both RFCs' test
 * vectors in the spec — which is the reason it is hand-written rather than a
 * dependency: the payload is content-free by policy, but it is still
 * somebody's notification, and the encryption is worth being able to read.
 */

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32-byte private scalar. */
  privateKey: string;
  /** `mailto:` or `https:` — who the push service may contact about abuse. */
  subject: string;
}

const RECORD_SIZE = 4096;

const b64url = (buf: Buffer): string => buf.toString('base64url');
const unb64url = (text: string): Buffer => Buffer.from(text, 'base64url');

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** HKDF with a single output block, which is all RFC 8291 needs (≤ 32 bytes). */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/**
 * Encrypts one notification for one browser. `fixed` exists for the RFC test
 * vector only; in use the server key pair and the salt are fresh every time,
 * which is what makes two identical notifications unlinkable on the wire.
 */
export function encryptPayload(
  subscription: PushSubscription,
  plaintext: Buffer,
  fixed?: { serverPrivateKey: Buffer; salt: Buffer },
): Buffer {
  const uaPublic = unb64url(subscription.keys.p256dh);
  const authSecret = unb64url(subscription.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16)
    throw new Error('Malformed push subscription keys');

  const server = createECDH('prime256v1');
  if (fixed) server.setPrivateKey(fixed.serverPrivateKey);
  else server.generateKeys();
  const asPublic = server.getPublicKey();
  const ecdhSecret = server.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = fixed?.salt ?? randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // One record, ended by the 0x02 delimiter, no padding.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);

  return Buffer.concat([header, asPublic, ciphertext, cipher.getAuthTag()]);
}

/** `Authorization: vapid t=…, k=…` for one push service origin. */
export function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  now: Date = new Date(),
): string {
  const audience = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        // Twelve hours: under the 24-hour ceiling push services enforce.
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKey(vapid),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${vapid.publicKey}`;
}

function vapidPrivateKey(vapid: VapidKeys) {
  const pub = unb64url(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04)
    throw new Error('VAPID public key must be an uncompressed P-256 point');
  return createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
  });
}

/** A fresh VAPID key pair, for `scripts/generate-vapid-keys.ts`. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

/** Reads a stored subscription, or null for anything that is not one. */
export function parseSubscription(token: string): PushSubscription | null {
  try {
    const parsed = JSON.parse(token) as Partial<PushSubscription>;
    if (
      typeof parsed.endpoint !== 'string' ||
      !parsed.endpoint.startsWith('https://') ||
      typeof parsed.keys?.p256dh !== 'string' ||
      typeof parsed.keys.auth !== 'string'
    ) {
      return null;
    }
    return {
      endpoint: parsed.endpoint,
      keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth },
    };
  } catch {
    return null;
  }
}
