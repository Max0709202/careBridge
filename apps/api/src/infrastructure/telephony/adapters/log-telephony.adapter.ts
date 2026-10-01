import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import type {
  BridgedCallRequest,
  CallStatusListener,
  CallStatusUpdate,
  InboundWebhook,
  TelephonyPort,
  WebhookReply,
} from '../telephony.port';

/**
 * A call that happens only in the log, walking through the states a real one
 * would on timers — so the console's "ringing… connected… 1 min" and the
 * missed-call notification can be seen end to end without a provider account.
 *
 * How it ends is decided by the callee's number, so a test or a demo can
 * choose: ending in `0000` is not answered, `0001` is busy, anything else is
 * answered and lasts two steps. Numbers never appear in the log — only the
 * session id.
 */
export class LogTelephonyAdapter implements TelephonyPort {
  readonly driver = 'log' as const;
  readonly available = true;

  private readonly logger = new Logger('Telephony');
  private readonly listeners: CallStatusListener[] = [];

  constructor(private readonly stepMs: number) {}

  async startBridgedCall(
    request: BridgedCallRequest,
  ): Promise<{ providerRef: string }> {
    const providerRef = `log-${randomUUID()}`;
    const id = request.callSessionId;
    this.logger.log(`Relay call ${id}: ringing the caller`);

    const outcome: CallStatusUpdate['status'] = request.calleeNumber.endsWith('0000')
      ? 'noAnswer'
      : request.calleeNumber.endsWith('0001')
        ? 'busy'
        : 'completed';

    const steps: CallStatusUpdate[] = [
      { callSessionId: id, status: 'ringingCaller' },
      { callSessionId: id, status: 'ringingCallee' },
      ...(outcome === 'completed'
        ? [
            { callSessionId: id, status: 'inProgress' as const },
            { callSessionId: id, status: 'completed' as const, durationSeconds: 95 },
          ]
        : [{ callSessionId: id, status: outcome }]),
    ];

    steps.forEach((update, index) => {
      const timer = setTimeout(() => this.emit(update), this.stepMs * (index + 1));
      timer.unref?.();
    });

    return { providerRef };
  }

  /** The log adapter sends no webhooks, so it accepts none. */
  verifyWebhook(_webhook: InboundWebhook): boolean {
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

  subscribe(listener: CallStatusListener): void {
    this.listeners.push(listener);
  }

  private emit(update: CallStatusUpdate): void {
    this.logger.log(`Relay call ${update.callSessionId}: ${update.status}`);
    for (const listener of this.listeners) listener(update);
  }
}
