import type { PushMessage, PushPort, PushResult } from '../push.port';

/**
 * A deployment with no device apps: PUSH_DRIVER=none.
 *
 * Nothing is lost by sending nothing. Every notification is also written to
 * the in-app inbox the web apps read, and a web deployment registers no device
 * tokens — so there is never anybody here to push to. Reports zero sent rather
 * than pretending, which is the difference from the log adapter.
 */
export class NoDevicePushAdapter implements PushPort {
  readonly driver = 'none' as const;

  async send(_message: PushMessage): Promise<PushResult> {
    return { sent: 0, invalidTokens: [] };
  }
}
