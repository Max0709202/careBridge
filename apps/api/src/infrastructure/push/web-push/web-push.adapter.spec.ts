import { createECDH } from 'node:crypto';

import { VapidWebPushAdapter } from './web-push.adapter';
import { generateVapidKeys } from './web-push.crypto';

function browserSubscription(endpoint: string): string {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  return JSON.stringify({
    endpoint,
    keys: {
      p256dh: ua.getPublicKey().toString('base64url'),
      auth: Buffer.alloc(16, 7).toString('base64url'),
    },
  });
}

describe('VapidWebPushAdapter', () => {
  const vapid = { ...generateVapidKeys(), subject: 'mailto:ops@carebridge.example' };

  it('sends an encrypted, VAPID-signed push, and drops subscriptions the service says are gone', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: url.includes('gone') ? 410 : 201 });
    }) as unknown as typeof fetch;
    const adapter = new VapidWebPushAdapter(vapid, fetchImpl);

    const live = browserSubscription('https://push.example/live');
    const gone = browserSubscription('https://push.example/gone');
    const result = await adapter.send({
      tokens: [live, gone, 'not-a-subscription'],
      title: 'New message',
      body: 'Open CareBridge to read it.',
      data: { kind: 'messageReceived', conversationId: 'c-1' },
    });

    expect(result.sent).toBe(1);
    expect(result.invalidTokens.sort()).toEqual([gone, 'not-a-subscription'].sort());

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.authorization).toMatch(/^vapid t=.+, k=/);
    // The body is ciphertext: the title is not on the wire in the clear.
    expect(Buffer.from(calls[0]!.init.body as Buffer).toString()).not.toContain(
      'New message',
    );
  });

  it('exposes the public key browsers subscribe with', () => {
    expect(new VapidWebPushAdapter(vapid).publicKey).toBe(vapid.publicKey);
  });
});
