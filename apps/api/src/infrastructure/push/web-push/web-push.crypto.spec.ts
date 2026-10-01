import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  verify,
} from 'node:crypto';

import {
  encryptPayload,
  generateVapidKeys,
  parseSubscription,
  vapidAuthorization,
} from './web-push.crypto';

const b = (text: string) => Buffer.from(text, 'base64url');

describe('RFC 8291 payload encryption', () => {
  // RFC 8291, Appendix A.
  const vector = {
    plaintext: 'When I grow up, I want to be a watermelon',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPublic:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  };
  const subscription = {
    endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
    keys: { p256dh: vector.uaPublic, auth: vector.authSecret },
  };

  it('produces the RFC ciphertext for the RFC inputs', () => {
    const body = encryptPayload(subscription, Buffer.from(vector.plaintext), {
      serverPrivateKey: b(vector.asPrivate),
      salt: b(vector.salt),
    });
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('round-trips with fresh keys: the browser can read what is sent', () => {
    const body = encryptPayload(subscription, Buffer.from('{"title":"New message"}'));
    expect(decrypt(body, vector.uaPrivate, vector.uaPublic, vector.authSecret)).toBe(
      '{"title":"New message"}',
    );
  });

  it('never sends the same bytes twice for the same notification', () => {
    const a = encryptPayload(subscription, Buffer.from('same'));
    const c = encryptPayload(subscription, Buffer.from('same'));
    expect(a.equals(c)).toBe(false);
  });

  /** The browser's side of RFC 8291, so the round trip is checked independently. */
  function decrypt(
    body: Buffer,
    uaPrivate: string,
    uaPublic: string,
    auth: string,
  ): string {
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const asPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen, body.length - 16);
    const tag = body.subarray(body.length - 16);

    const ua = createECDH('prime256v1');
    ua.setPrivateKey(b(uaPrivate));
    const shared = ua.computeSecret(asPublic);
    const h = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
    const expand = (s: Buffer, ikm: Buffer, info: string | Buffer, n: number) =>
      h(h(s, ikm), Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, n);

    const ikm = expand(
      b(auth),
      shared,
      Buffer.concat([Buffer.from('WebPush: info\0'), b(uaPublic), asPublic]),
      32,
    );
    const cek = expand(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
    const nonce = expand(salt, ikm, 'Content-Encoding: nonce\0', 12);
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    expect(plain[plain.length - 1]).toBe(2);
    return plain.subarray(0, -1).toString();
  }
});

describe('RFC 8292 VAPID', () => {
  it('signs a token the public key verifies, scoped to the push service origin', () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization(
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      { ...keys, subject: 'mailto:ops@carebridge.example' },
      new Date('2026-10-01T12:00:00Z'),
    );

    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(keys.publicKey);

    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(claims).toEqual({
      aud: 'https://updates.push.services.mozilla.com',
      exp: Date.parse('2026-10-01T12:00:00Z') / 1000 + 12 * 3600,
      sub: 'mailto:ops@carebridge.example',
    });

    const pub = b(keys.publicKey);
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33).toString('base64url'),
      },
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${c}`),
        { key, dsaEncoding: 'ieee-p1363' },
        b(s!),
      ),
    ).toBe(true);
  });
});

describe('parseSubscription', () => {
  it('accepts a browser subscription and refuses anything else', () => {
    const good = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      keys: { p256dh: 'a', auth: 'b' },
    };
    expect(parseSubscription(JSON.stringify(good))).toEqual(good);
    expect(parseSubscription('an-fcm-token')).toBeNull();
    expect(
      parseSubscription(
        JSON.stringify({ ...good, endpoint: 'http://insecure.example' }),
      ),
    ).toBeNull();
  });
});
