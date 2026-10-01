/**
 * Relay calls, independent of the provider. ADR-0014.
 *
 * The shape is a **click-to-call bridge**: the provider rings the caller's own
 * phone from the relay number, and when they answer it rings the callee from
 * the same number and joins the two. Neither side ever sees the other's real
 * number, and it works for anyone with a phone — a dispatcher at a desk set,
 * or a patient who has never installed anything.
 *
 * Numbers pass through this port at dial time and are not kept by it or by
 * anything that calls it.
 */

import type { CallStatusName } from '../../domain/relay-calls';

export interface BridgedCallRequest {
  /** Ours. Carried through the provider's callbacks so they can be matched. */
  callSessionId: string;
  relayNumber: string;
  callerNumber: string;
  /**
   * The callee. The Twilio adapter does not send it at this point — it is
   * resolved again when the caller answers — but the log adapter needs it to
   * decide how its simulation ends.
   */
  calleeNumber: string;
}

/** Which leg a status callback is about. */
export type CallLeg = 'caller' | 'callee' | 'dial';

/** A provider callback, reduced to what the call's state machine needs. */
export interface CallStatusUpdate {
  callSessionId: string;
  status: CallStatusName;
  /** Talk time, once known. */
  durationSeconds?: number;
}

/** A provider-shaped HTTP reply to a webhook (TwiML for Twilio). */
export interface WebhookReply {
  contentType: string;
  body: string;
}

/** A webhook as the controller received it — enough to verify and read it. */
export interface InboundWebhook {
  /** Path and query exactly as requested, e.g. `/telephony/status?session=…&leg=caller`. */
  pathAndQuery: string;
  params: Record<string, string>;
  signature: string | undefined;
}

export type CallStatusListener = (update: CallStatusUpdate) => void;

export interface TelephonyPort {
  readonly driver: 'twilio' | 'log' | 'none';

  /** Whether calls can be placed at all. False for `none`. */
  readonly available: boolean;

  /** Starts leg one. Resolves with the provider's id for the call. */
  startBridgedCall(request: BridgedCallRequest): Promise<{ providerRef: string }>;

  /** True only for a webhook the provider provably sent. */
  verifyWebhook(webhook: InboundWebhook): boolean;

  /** Reads a status webhook for one leg; null for one that changes nothing. */
  readStatus(
    callSessionId: string,
    leg: CallLeg,
    params: Record<string, string>,
  ): CallStatusUpdate | null;

  /** What to do once the caller answers: dial the callee, or apologise. */
  bridgeReply(
    callSessionId: string,
    calleeNumber: string | null,
    relayNumber: string,
  ): WebhookReply;

  /** Ends a call politely once the bridged leg is over. */
  hangupReply(): WebhookReply;

  /** Someone rang the relay number back. */
  inboundReply(forwardTo: string | null, relayNumber: string): WebhookReply;

  /** The caller's number on an inbound call. */
  inboundFrom(params: Record<string, string>): string | null;

  /**
   * Status changes the adapter produces itself. Only the log adapter uses it —
   * it has no provider to send webhooks — and it is how a local call walks
   * through its states without one.
   */
  subscribe(listener: CallStatusListener): void;
}

export const TELEPHONY = Symbol('TELEPHONY');
