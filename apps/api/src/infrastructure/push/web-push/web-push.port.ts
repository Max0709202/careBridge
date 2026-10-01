import type { PushMessage, PushResult } from '../push.port';

/**
 * Push to browsers (the React web apps), beside FCM for the native ones. A
 * separate port because the tokens are a different thing — a whole
 * subscription, endpoint and keys, rather than an opaque FCM id — and because
 * a deployment may have one configured without the other.
 */
export interface WebPushPort {
  readonly driver: 'vapid' | 'none';
  /** The key browsers subscribe with, or null when web push is not set up. */
  readonly publicKey: string | null;
  send(message: PushMessage): Promise<PushResult>;
}

export const WEB_PUSH = Symbol('WEB_PUSH');
