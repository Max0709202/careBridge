import { Logger } from '@nestjs/common';

import type { PushMessage, PushResult } from '../push.port';
import type { WebPushPort } from './web-push.port';
import {
  encryptPayload,
  parseSubscription,
  vapidAuthorization,
  type VapidKeys,
} from './web-push.crypto';

/** Long enough to reach a laptop that was closed over lunch; not so long a stale alert lands tomorrow. */
const TTL_SECONDS = 4 * 60 * 60;
const REQUEST_TIMEOUT_MS = 10_000;

export class VapidWebPushAdapter implements WebPushPort {
  readonly driver = 'vapid' as const;
  private readonly logger = new Logger('WebPush');

  constructor(
    private readonly vapid: VapidKeys,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get publicKey(): string {
    return this.vapid.publicKey;
  }

  async send(message: PushMessage): Promise<PushResult> {
    const payload = Buffer.from(
      JSON.stringify({
        title: message.title,
        body: message.body,
        data: message.data ?? {},
      }),
    );

    let sent = 0;
    const invalidTokens: string[] = [];

    await Promise.all(
      message.tokens.map(async (token) => {
        const subscription = parseSubscription(token);
        if (!subscription) {
          invalidTokens.push(token);
          return;
        }
        try {
          const response = await this.fetchImpl(subscription.endpoint, {
            method: 'POST',
            headers: {
              authorization: vapidAuthorization(subscription.endpoint, this.vapid),
              'content-encoding': 'aes128gcm',
              'content-type': 'application/octet-stream',
              ttl: String(TTL_SECONDS),
              urgency: 'high',
            },
            body: encryptPayload(subscription, payload),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (response.status === 404 || response.status === 410) {
            // The browser unsubscribed or the profile is gone. Stop paying for it.
            invalidTokens.push(token);
          } else if (response.ok) {
            sent += 1;
          } else {
            this.logger.warn(
              `Push service refused a notification (HTTP ${response.status})`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Push service unreachable: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }),
    );

    return { sent, invalidTokens };
  }
}

/** Web push not configured: nothing is sent, and the dispatcher records it as suppressed. */
export class NoWebPushAdapter implements WebPushPort {
  readonly driver = 'none' as const;
  readonly publicKey = null;

  async send(_message: PushMessage): Promise<PushResult> {
    return { sent: 0, invalidTokens: [] };
  }
}
