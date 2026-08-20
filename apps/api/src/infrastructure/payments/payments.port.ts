/**
 * Moving money, independent of the processor.
 *
 * Behind an interface for the same reason maps and mail are, plus one that is
 * specific to payments: the thing on the other side of this port is the only
 * component in the system whose failure costs money in both directions. A
 * charge that silently succeeds twice and a charge that silently never happens
 * are both invisible from inside the application, so the port is written so
 * that neither can be *expressed* — every attempt carries an idempotency key,
 * and every outcome is one of three named states rather than a boolean.
 *
 * ADR-0006 picks Stripe. What that ADR buys is that no card number, CVC or
 * expiry ever reaches this process: the client tokenises against the processor
 * and we hold an opaque reference. Nothing in this file takes a card number,
 * and nothing should ever be added that does.
 */

/** What we keep about a card, which is only what identifies it to its owner. */
export interface PaymentMethodDetails {
  /** The processor's token. The only handle on the card that exists here. */
  externalId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface ChargeRequest {
  amountCents: number;
  currency: string;
  /** The processor's customer reference. */
  customerRef: string;
  /** The processor's payment-method reference. */
  paymentMethodRef: string;

  /**
   * Stable across retries of the *same* attempt.
   *
   * This is the one field that decides whether a network timeout costs the
   * customer twice. Our `Payment` row is created before the call and its id
   * seeds this key, so a retry after a lost response is answered from the
   * processor's record rather than performed again.
   */
  idempotencyKey: string;

  /** Shown on the cardholder's statement. Carries no patient detail. */
  description: string;
}

export type ChargeOutcome =
  | { status: 'succeeded'; externalPaymentId: string }
  | {
      status: 'failed';
      externalPaymentId: string | null;
      /** Fed to `classifyDecline` to decide whether a retry can succeed. */
      failureCode: string;
      failureMessage: string;
    }
  /**
   * Submitted, outcome not yet known — a card that wants the cardholder to
   * authenticate, or a processor that has taken the request and not settled
   * it. Deliberately *not* collapsed into failure: treating "we do not know"
   * as "it did not work" retries a charge that may already have succeeded.
   * The webhook settles it.
   */
  | { status: 'pending'; externalPaymentId: string };

export interface RefundOutcome {
  externalRefundId: string;
  amountCents: number;
}

/** A processor event, once its signature has been verified. */
export interface ProcessorWebhookEvent {
  /** The processor's event id. Unique, and what makes redelivery a no-op. */
  id: string;
  type: string;
  /**
   * The processor's reference for the payment this event concerns, where the
   * event concerns one. Null for event types we do not act on.
   */
  externalPaymentId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  amountCents: number | null;
}

export interface PaymentsPort {
  /** Which implementation is live. Reported at boot and by /health/ready. */
  readonly driver: 'stripe' | 'local';

  /**
   * The processor's customer record, created if this account has none.
   * Idempotent on `accountId`, which is what makes a retried subscribe safe.
   */
  ensureCustomer(input: {
    accountId: string;
    email: string;
    existingRef: string | null;
  }): Promise<string>;

  /**
   * Binds a token the client obtained directly from the processor to a
   * customer. `token` is never a card number — see the note at the top.
   */
  attachPaymentMethod(input: {
    customerRef: string;
    token: string;
  }): Promise<PaymentMethodDetails>;

  detachPaymentMethod(externalId: string): Promise<void>;

  charge(request: ChargeRequest): Promise<ChargeOutcome>;

  refund(input: {
    externalPaymentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<RefundOutcome>;

  /**
   * Verifies a webhook's signature and parses it.
   *
   * Throws on a bad signature rather than returning null: an unverified
   * webhook is an unauthenticated request claiming a payment succeeded, and
   * there is no reading of it that should reach a handler.
   *
   * Takes the **raw** body. A signature is over the exact bytes sent, so a
   * body that has been through a JSON parser and re-serialised will not
   * verify — which is why the route that calls this is mounted with a raw
   * body parser.
   */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): ProcessorWebhookEvent;
}

export const PAYMENTS = Symbol('PAYMENTS');
