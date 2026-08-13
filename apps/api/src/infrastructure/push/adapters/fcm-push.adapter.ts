import { Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';

import type { PushMessage, PushPort, PushResult } from '../push.port';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * FCM HTTP v1, spoken directly.
 *
 * `firebase-admin` would do this too, and would add roughly fifty megabytes of
 * transitive dependencies to an image whose only use for it is one POST. The
 * whole protocol is here: sign a JWT with the service-account key, exchange it
 * for an access token, and send one message per registration token. That is a
 * hundred lines we own and can read, against a dependency tree we would not.
 *
 * The one thing this must get right besides sending is **telling us which
 * tokens are dead**. Registration tokens rotate and apps get uninstalled; a
 * system that never prunes them spends the rest of its life pushing to phones
 * that no longer exist.
 */
export class FcmPushAdapter implements PushPort {
  readonly driver = 'fcm' as const;

  private readonly logger = new Logger('Push');
  private readonly account: ServiceAccount;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(serviceAccountJson: string) {
    const parsed = JSON.parse(serviceAccountJson) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error(
        'FCM_SERVICE_ACCOUNT_JSON must contain project_id, client_email and private_key.',
      );
    }
    this.account = parsed as ServiceAccount;
  }

  async send(message: PushMessage): Promise<PushResult> {
    if (message.tokens.length === 0) return { sent: 0, invalidTokens: [] };

    const accessToken = await this.accessToken();
    const endpoint = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;

    let sent = 0;
    const invalidTokens: string[] = [];

    // Sequential rather than parallel. Push is never on a request's critical
    // path — it runs from a queue worker — and a fan-out of a hundred parallel
    // HTTPS requests to one host is how a worker earns a rate limit.
    for (const token of message.tokens) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            ...(message.data ? { data: message.data } : {}),
            android: { priority: 'high' },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: { aps: { sound: 'default' } },
            },
          },
        }),
      });

      if (response.ok) {
        sent += 1;
        continue;
      }

      const status = describeError(await response.text());

      // 404 UNREGISTERED and 400 INVALID_ARGUMENT on the token field both mean
      // "this token will never work again". Anything else is transient and the
      // job's retry will pick it up.
      if (response.status === 404 || status === 'UNREGISTERED') {
        invalidTokens.push(token);
        continue;
      }
      if (response.status === 400 && status === 'INVALID_ARGUMENT') {
        invalidTokens.push(token);
        continue;
      }

      // The token itself is not logged: it is a device identifier.
      this.logger.warn(`FCM rejected a send: ${response.status} ${status}`);
    }

    return { sent, invalidTokens };
  }

  /**
   * A service-account access token, cached until shortly before it expires.
   *
   * Re-minting one per notification would add a round trip to every push and
   * would be noticed by Google's quota before it was noticed by us.
   */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.value;
    }

    const tokenUri = this.account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const assertion = this.signAssertion(tokenUri, now);

    const response = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Could not obtain an FCM access token: ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      value: body.access_token,
      expiresAt: now + body.expires_in,
    };
    return body.access_token;
  }

  private signAssertion(audience: string, issuedAt: number): string {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: audience,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    );

    const signature = createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(this.account.private_key)
      .toString('base64url');

    return `${header}.${claims}.${signature}`;
  }
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

/** FCM's error status string, or the HTTP status text if the body is not JSON. */
function describeError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; details?: Array<{ errorCode?: string }> };
    };
    return parsed.error?.details?.[0]?.errorCode ?? parsed.error?.status ?? 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}
