import { createHmac, timingSafeEqual } from 'node:crypto';

import type { CallStatusName } from '../../../domain/relay-calls';
import type {
  BridgedCallRequest,
  CallLeg,
  CallStatusUpdate,
  InboundWebhook,
  TelephonyPort,
  WebhookReply,
} from '../telephony.port';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The API's public base as Twilio reaches it, e.g. https://carebridge.example/api/v1 */
  webhookBaseUrl: string;
}

/** How long a phone rings before it counts as not answered. */
const RING_SECONDS = 30;

/** Talking to Twilio must not hold a request open while it has a bad day. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Twilio Programmable Voice, over its REST API and TwiML.
 *
 * No SDK: the surface used is one POST and one signature check, and the SDK
 * would be a large dependency for that. Nothing is recorded — there is no
 * `record` attribute anywhere below, and that absence is the policy.
 */
export class TwilioTelephonyAdapter implements TelephonyPort {
  readonly driver = 'twilio' as const;
  readonly available = true;

  private readonly base: string;

  constructor(private readonly config: TwilioConfig) {
    this.base = config.webhookBaseUrl.replace(/\/+$/, '');
  }

  async startBridgedCall(
    request: BridgedCallRequest,
  ): Promise<{ providerRef: string }> {
    const session = encodeURIComponent(request.callSessionId);
    const form = new URLSearchParams({
      To: request.callerNumber,
      From: request.relayNumber,
      Url: `${this.base}/telephony/voice/bridge?session=${session}`,
      Method: 'POST',
      StatusCallback: `${this.base}/telephony/status?session=${session}&leg=caller`,
      StatusCallbackMethod: 'POST',
      Timeout: String(RING_SECONDS),
    });
    for (const event of ['initiated', 'ringing', 'answered', 'completed']) {
      form.append('StatusCallbackEvent', event);
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Calls.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      // Twilio's error body can echo the numbers back. The status is enough.
      throw new Error(`Twilio refused the call (HTTP ${response.status})`);
    }

    const body = (await response.json()) as { sid?: unknown };
    if (typeof body.sid !== 'string') throw new Error('Twilio returned no call sid');
    return { providerRef: body.sid };
  }

  /**
   * Twilio's scheme: HMAC-SHA1 with the auth token, over the full URL it
   * requested followed by every POST parameter as key+value, sorted by key.
   * The URL is rebuilt from the configured base rather than from the Host
   * header, which behind nginx is not what Twilio called.
   */
  verifyWebhook(webhook: InboundWebhook): boolean {
    if (!webhook.signature) return false;

    const url = `${this.base}${webhook.pathAndQuery}`;
    const payload =
      url +
      Object.keys(webhook.params)
        .sort()
        .map((key) => `${key}${webhook.params[key]}`)
        .join('');

    const expected = createHmac('sha1', this.config.authToken)
      .update(payload, 'utf8')
      .digest();
    const given = Buffer.from(webhook.signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  readStatus(
    callSessionId: string,
    leg: CallLeg,
    params: Record<string, string>,
  ): CallStatusUpdate | null {
    const status =
      leg === 'dial'
        ? dialOutcome(params['DialCallStatus'])
        : legStatus(leg, params['CallStatus']);
    if (!status) return null;

    const duration = Number(
      leg === 'dial' ? params['DialCallDuration'] : params['CallDuration'],
    );
    return {
      callSessionId,
      status,
      ...(Number.isFinite(duration) && status === 'completed'
        ? { durationSeconds: duration }
        : {}),
    };
  }

  bridgeReply(
    callSessionId: string,
    calleeNumber: string | null,
    relayNumber: string,
  ): WebhookReply {
    if (!calleeNumber) {
      return twiml(
        '<Say>Sorry, this call cannot be connected right now.</Say><Hangup/>',
      );
    }
    const session = encodeURIComponent(callSessionId);
    return twiml(
      '<Say>Connecting your CareBridge call.</Say>' +
        `<Dial callerId="${xml(relayNumber)}" timeout="${RING_SECONDS}" answerOnBridge="true" ` +
        `action="${xml(`${this.base}/telephony/voice/dial-result?session=${session}`)}" method="POST">` +
        `<Number statusCallbackEvent="ringing answered completed" statusCallbackMethod="POST" ` +
        `statusCallback="${xml(`${this.base}/telephony/status?session=${session}&leg=callee`)}">` +
        `${xml(calleeNumber)}</Number></Dial>`,
    );
  }

  hangupReply(): WebhookReply {
    return twiml('<Hangup/>');
  }

  inboundReply(forwardTo: string | null, relayNumber: string): WebhookReply {
    if (!forwardTo) {
      return twiml(
        '<Say>This number connects CareBridge calls. To reach dispatch, please open the CareBridge app.</Say><Hangup/>',
      );
    }
    return twiml(
      `<Say>Connecting you to dispatch.</Say><Dial callerId="${xml(relayNumber)}" timeout="${RING_SECONDS}">${xml(forwardTo)}</Dial>`,
    );
  }

  inboundFrom(params: Record<string, string>): string | null {
    const from = params['From'];
    return typeof from === 'string' && from.length > 0 ? from : null;
  }

  subscribe(): void {
    // Twilio's status changes arrive as webhooks, through the controller.
  }
}

/** The caller's leg moves the call to "ringing the callee" once answered; its end is read from the dial result. */
function legStatus(
  leg: 'caller' | 'callee',
  status: string | undefined,
): CallStatusName | null {
  if (leg === 'caller') {
    switch (status) {
      case 'ringing':
        return 'ringingCaller';
      case 'in-progress':
        return 'ringingCallee';
      // The caller did not pick up their own phone. Nobody else was rung.
      case 'no-answer':
      case 'busy':
      case 'canceled':
        return 'canceled';
      case 'failed':
        return 'failed';
      default:
        return null;
    }
  }
  switch (status) {
    case 'ringing':
      return 'ringingCallee';
    case 'in-progress':
    case 'answered':
      return 'inProgress';
    default:
      // Its end is reported by the dial action, with the reason.
      return null;
  }
}

function dialOutcome(status: string | undefined): CallStatusName | null {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'no-answer':
      return 'noAnswer';
    case 'busy':
      return 'busy';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return null;
  }
}

function twiml(inner: string): WebhookReply {
  return {
    contentType: 'text/xml',
    body: `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
  };
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
