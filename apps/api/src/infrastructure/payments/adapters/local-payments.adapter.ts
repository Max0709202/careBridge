import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

import type {
  ChargeOutcome,
  ChargeRequest,
  PaymentMethodDetails,
  PaymentsPort,
  ProcessorWebhookEvent,
  RefundOutcome,
} from '../payments.port';
import { verifySignedPayload, WebhookSignatureError } from '../webhook-signature';

/**
 * A processor that moves no money, for a machine with no Stripe account.
 *
 * It exists so `git clone && docker compose up` demonstrates the *whole*
 * product, declines included. A local adapter that always succeeded would
 * leave dunning — retries, the grace window, the expiry at the end of it —
 * reachable only in an environment nobody develops against, which is how the
 * unhappy path of a payment system ends up written but never run.
 *
 * So the outcome is decided by the card, using the **same last four digits
 * Stripe's test cards use**. `4242` succeeds here and succeeds there; `9995`
 * is declined for insufficient funds in both. That correspondence is the
 * feature: a developer reproducing a customer's dunning sequence locally uses
 * the card number from the ticket.
 *
 * Config validation refuses this adapter in production. It is the most
 * important of those refusals — an adapter that reports every charge as
 * settled is a system that bills nobody and says everything is fine.
 */
export class LocalPaymentsAdapter implements PaymentsPort {
  readonly driver = 'local' as const;

  private readonly logger = new Logger('Payments');

  /** Signs its own webhooks, so the verification path is a real one. */
  constructor(private readonly webhookSecret: string) {}

  async ensureCustomer(input: {
    accountId: string;
    email: string;
    existingRef: string | null;
  }): Promise<string> {
    // Derived from the account id rather than random, so a retried call
    // returns the same reference — which is what `ensureCustomer` promises
    // and what a real processor's idempotency would give us.
    return input.existingRef ?? `cus_local_${shortHash(input.accountId)}`;
  }

  async attachPaymentMethod(input: {
    customerRef: string;
    token: string;
  }): Promise<PaymentMethodDetails> {
    const last4 = lastFourOf(input.token);

    return {
      // The last four are **in** the reference, not merely beside it.
      //
      // `charge` receives only this reference — that is what a processor token
      // is — so a reference that did not carry the card's identity would leave
      // the scripted outcome to be recovered from a hash, which is to say
      // chosen at random. The decline path would then be unreachable by
      // choosing a card, which is the one thing this adapter exists to offer.
      externalId: `pm_local_${last4}_${shortHash(`${input.customerRef}:${input.token}`)}`,
      brand: brandFor(last4),
      last4,
      // Far enough out that a fixture written today does not start failing an
      // expiry check in eighteen months.
      expMonth: 12,
      expYear: new Date().getUTCFullYear() + 4,
    };
  }

  async detachPaymentMethod(): Promise<void> {
    // Nothing is held, so there is nothing to release.
  }

  async charge(request: ChargeRequest): Promise<ChargeOutcome> {
    const last4 = lastFourOfReference(request.paymentMethodRef);
    const scripted = last4 ? SCRIPTED_CARDS[last4] : undefined;

    // The reference is derived from the idempotency key, so replaying an
    // attempt yields the same processor id — the property the real one has,
    // and the property the payment table's unique constraint relies on.
    const externalPaymentId = `pi_local_${shortHash(request.idempotencyKey)}`;

    if (!scripted) {
      return { status: 'succeeded', externalPaymentId };
    }
    if (scripted.outcome === 'pending') {
      return { status: 'pending', externalPaymentId };
    }

    this.logger.debug(
      `Local charge declined (${scripted.failureCode}) for ${request.description}`,
    );
    return {
      status: 'failed',
      externalPaymentId,
      failureCode: scripted.failureCode,
      failureMessage: scripted.failureMessage,
    };
  }

  async refund(input: {
    externalPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<RefundOutcome> {
    return {
      // Derived from the key, not random, for the same reason a charge's
      // reference is: a replayed refund must be recognisable as the same one.
      externalRefundId: `re_local_${shortHash(input.idempotencyKey)}`,
      amountCents: input.amountCents,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): ProcessorWebhookEvent {
    verifySignedPayload({
      rawBody,
      signatureHeader: signature,
      secret: this.webhookSecret,
      now: new Date(),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('Webhook body is not JSON.');
    }

    return readEvent(parsed);
  }
}

interface ScriptedCard {
  outcome: 'declined' | 'pending';
  failureCode: string;
  failureMessage: string;
}

/**
 * Stripe's test-card last four, with Stripe's meanings.
 *
 * `9979` is the one that matters most to the dunning rules: it is classified
 * terminal, so it proves the branch that gives up immediately rather than
 * retrying a stolen card three more times over eight days.
 */
const SCRIPTED_CARDS: Record<string, ScriptedCard | undefined> = {
  '9995': {
    outcome: 'declined',
    failureCode: 'card_declined_insufficient_funds',
    failureMessage: 'The card has insufficient funds.',
  },
  '9979': {
    outcome: 'declined',
    failureCode: 'card_declined_stolen_card',
    failureMessage: 'The card has been reported stolen.',
  },
  '0069': {
    outcome: 'declined',
    failureCode: 'expired_card',
    failureMessage: 'The card has expired.',
  },
  '0341': {
    outcome: 'pending',
    failureCode: '',
    failureMessage: '',
  },
};

/**
 * The last four digits a *token* carries, or a stable stand-in.
 *
 * Tokens that carry no digits are hashed to four instead, so a fixture still
 * gets a plausible, stable "card" to display rather than four zeroes.
 */
function lastFourOf(token: string): string {
  const digits = token.replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return (parseInt(shortHash(token), 16) % 10_000).toString().padStart(4, '0');
}

/**
 * The last four digits out of a reference this adapter minted.
 *
 * Anchored to the exact shape `attachPaymentMethod` writes rather than
 * scanning the string for digits: the hash that follows is hex and contains
 * digits of its own, so a loose search would return four characters of the
 * hash and pick a scripted outcome at random. Null for anything else, which
 * charges successfully — the safe default for a reference we did not mint.
 */
function lastFourOfReference(reference: string): string | null {
  return /^pm_local_(\d{4})_/.exec(reference)?.[1] ?? null;
}

function brandFor(last4: string): string {
  const BRANDS = ['visa', 'mastercard', 'amex', 'discover'];
  return BRANDS[Number(last4) % BRANDS.length] ?? 'visa';
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * Reads the subset of a processor event this system acts on.
 *
 * Shared in shape with the Stripe adapter deliberately: the handler must not
 * be able to tell which adapter produced the event it is given.
 */
export function readEvent(parsed: unknown): ProcessorWebhookEvent {
  const body = (parsed ?? {}) as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const object = (data.object ?? {}) as Record<string, unknown>;

  const id = typeof body.id === 'string' ? body.id : null;
  const type = typeof body.type === 'string' ? body.type : null;

  if (!id || !type) {
    throw new WebhookSignatureError('Webhook is missing an id or a type.');
  }

  const error = (object.last_payment_error ?? {}) as Record<string, unknown>;

  return {
    id,
    type,
    externalPaymentId: typeof object.id === 'string' ? object.id : null,
    failureCode: typeof error.code === 'string' ? error.code : null,
    failureMessage: typeof error.message === 'string' ? error.message : null,
    amountCents: typeof object.amount === 'number' ? object.amount : null,
  };
}
