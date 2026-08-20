import { Logger } from '@nestjs/common';

import type {
  ChargeOutcome,
  ChargeRequest,
  PaymentMethodDetails,
  PaymentsPort,
  ProcessorWebhookEvent,
  RefundOutcome,
} from '../payments.port';
import { verifySignedPayload, WebhookSignatureError } from '../webhook-signature';
import { readEvent } from './local-payments.adapter';

/**
 * Stripe, spoken directly.
 *
 * The `stripe` package would do this too. It is not used for the same reason
 * `firebase-admin` is not used in the push adapter: this system touches a
 * handful of endpoints — a customer, a payment method, a payment intent, a
 * refund — and the whole of that is the two hundred lines below, which we can
 * read, against a dependency tree we cannot.
 *
 * Two things here carry more weight than the rest.
 *
 * **Idempotency-Key on every mutating call.** Stripe deduplicates on it for 24
 * hours. Without it, a request that times out after Stripe has taken the money
 * but before we see the response is retried by us as a second charge, and the
 * customer's recourse is noticing. The key comes from our own `Payment` row,
 * which is written before the call, so it is stable across every retry of that
 * attempt and different for the next one.
 *
 * **A declined card is not an exception.** Stripe reports declines as HTTP 402
 * with an error body, and a decline is an ordinary business outcome that the
 * dunning schedule is built to handle. Only transport and configuration
 * failures throw.
 */
export class StripePaymentsAdapter implements PaymentsPort {
  readonly driver = 'stripe' as const;

  private readonly logger = new Logger('Payments');
  private static readonly BASE = 'https://api.stripe.com/v1';
  private static readonly TIMEOUT_MS = 20_000;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  async ensureCustomer(input: {
    accountId: string;
    email: string;
    existingRef: string | null;
  }): Promise<string> {
    if (input.existingRef) return input.existingRef;

    const created = await this.post<{ id: string }>(
      'customers',
      {
        email: input.email,
        'metadata[billingAccountId]': input.accountId,
      },
      // Keyed on our account id, so two concurrent first-subscribes cannot
      // create two customers for one household.
      `customer:${input.accountId}`,
    );

    return created.id;
  }

  async attachPaymentMethod(input: {
    customerRef: string;
    token: string;
  }): Promise<PaymentMethodDetails> {
    const attached = await this.post<StripePaymentMethod>(
      `payment_methods/${encodeURIComponent(input.token)}/attach`,
      { customer: input.customerRef },
      `attach:${input.customerRef}:${input.token}`,
    );

    const card = attached.card;
    if (!card) {
      throw new Error('Stripe returned a payment method with no card details.');
    }

    return {
      externalId: attached.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
    };
  }

  async detachPaymentMethod(externalId: string): Promise<void> {
    await this.post(
      `payment_methods/${encodeURIComponent(externalId)}/detach`,
      {},
      `detach:${externalId}`,
    );
  }

  async charge(request: ChargeRequest): Promise<ChargeOutcome> {
    let intent: StripePaymentIntent;

    try {
      intent = await this.post<StripePaymentIntent>(
        'payment_intents',
        {
          amount: String(request.amountCents),
          currency: request.currency,
          customer: request.customerRef,
          payment_method: request.paymentMethodRef,
          description: request.description,
          confirm: 'true',
          // Charging a stored card with nobody present. Declaring it is what
          // makes the network treat the charge as a recurring one, which is
          // what stops issuers declining it for lack of authentication.
          off_session: 'true',
          'automatic_payment_methods[enabled]': 'true',
          'automatic_payment_methods[allow_redirects]': 'never',
        },
        request.idempotencyKey,
      );
    } catch (error) {
      if (error instanceof StripeCardError) {
        return {
          status: 'failed',
          externalPaymentId: error.paymentIntentId,
          failureCode: error.code,
          failureMessage: error.message,
        };
      }
      throw error;
    }

    return this.outcomeOf(intent);
  }

  private outcomeOf(intent: StripePaymentIntent): ChargeOutcome {
    switch (intent.status) {
      case 'succeeded':
        return { status: 'succeeded', externalPaymentId: intent.id };

      case 'requires_payment_method':
      case 'canceled':
        return {
          status: 'failed',
          externalPaymentId: intent.id,
          failureCode: intent.last_payment_error?.code ?? 'payment_failed',
          failureMessage:
            intent.last_payment_error?.message ?? 'The payment was not completed.',
        };

      // requires_action, requires_confirmation, processing. Not a failure: the
      // money may yet move, and retrying now would be a second charge.
      default:
        return { status: 'pending', externalPaymentId: intent.id };
    }
  }

  async refund(input: {
    externalPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<RefundOutcome> {
    const refund = await this.post<{ id: string; amount: number }>(
      'refunds',
      {
        payment_intent: input.externalPaymentId,
        amount: String(input.amountCents),
      },
      input.idempotencyKey,
    );

    return { externalRefundId: refund.id, amountCents: refund.amount };
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

  /**
   * One POST, form-encoded, as the Stripe API expects.
   *
   * Nothing here logs a request body. A body carries a customer reference and
   * an amount, and while it carries no card number, an amount beside an email
   * address in a log line is more than an incident responder needs.
   */
  private async post<T>(
    path: string,
    body: Record<string, string>,
    idempotencyKey: string,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${StripePaymentsAdapter.BASE}/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': idempotencyKey,
          'stripe-version': '2024-06-20',
        },
        body: new URLSearchParams(body).toString(),
        signal: AbortSignal.timeout(StripePaymentsAdapter.TIMEOUT_MS),
      });
    } catch (error) {
      // A timeout is the dangerous case: the charge may have succeeded. It is
      // rethrown rather than reported as a decline, so the caller leaves the
      // payment `pending` and lets the webhook settle it — retrying here would
      // be the double charge the idempotency key exists to prevent.
      throw new Error(
        `Stripe request failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    const text = await response.text();

    if (response.ok) return JSON.parse(text) as T;

    const failure = parseError(text);

    if (isCardFailure(response.status, failure)) {
      throw new StripeCardError(
        failure.code ?? 'card_declined',
        failure.message ?? 'The card was declined.',
        failure.paymentIntentId,
      );
    }

    this.logger.error(`Stripe ${path} returned ${response.status}: ${failure.type}`);
    throw new Error(`Stripe returned ${response.status} for ${path}.`);
  }
}

/** A decline, as distinct from a transport or configuration failure. */
class StripeCardError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly paymentIntentId: string | null,
  ) {
    super(message);
    this.name = 'StripeCardError';
  }
}

function isCardFailure(status: number, failure: ParsedStripeError): boolean {
  return status === 402 || failure.type === 'card_error';
}

interface ParsedStripeError {
  type: string | null;
  code: string | null;
  message: string | null;
  paymentIntentId: string | null;
}

function parseError(text: string): ParsedStripeError {
  try {
    const body = JSON.parse(text) as {
      error?: {
        type?: string;
        code?: string;
        decline_code?: string;
        message?: string;
        payment_intent?: { id?: string };
      };
    };
    const error = body.error ?? {};

    return {
      type: error.type ?? null,
      // `decline_code` is the issuer's reason and is what `classifyDecline`
      // can act on; `code` is usually the generic "card_declined".
      code: error.decline_code ?? error.code ?? null,
      message: error.message ?? null,
      paymentIntentId: error.payment_intent?.id ?? null,
    };
  } catch {
    return { type: null, code: null, message: null, paymentIntentId: null };
  }
}

interface StripePaymentMethod {
  id: string;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number };
}

interface StripePaymentIntent {
  id: string;
  status: string;
  last_payment_error?: { code?: string; message?: string };
}
