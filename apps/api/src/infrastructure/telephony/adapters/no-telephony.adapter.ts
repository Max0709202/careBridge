import { ConflictError } from '../../../common/errors';
import type {
  BridgedCallRequest,
  CallStatusUpdate,
  TelephonyPort,
  WebhookReply,
} from '../telephony.port';

/**
 * Calling switched off. Every attempt says so plainly — the apps show "calling
 * is not set up" rather than a button that silently does nothing.
 */
export class NoTelephonyAdapter implements TelephonyPort {
  readonly driver = 'none' as const;
  readonly available = false;

  startBridgedCall(_request: BridgedCallRequest): Promise<{ providerRef: string }> {
    return Promise.reject(
      new ConflictError('Calling is not set up for CareBridge yet.'),
    );
  }

  verifyWebhook(): boolean {
    return false;
  }

  readStatus(): CallStatusUpdate | null {
    return null;
  }

  bridgeReply(): WebhookReply {
    return { contentType: 'text/plain', body: '' };
  }

  hangupReply(): WebhookReply {
    return { contentType: 'text/plain', body: '' };
  }

  inboundReply(): WebhookReply {
    return { contentType: 'text/plain', body: '' };
  }

  inboundFrom(): string | null {
    return null;
  }

  subscribe(): void {}
}
