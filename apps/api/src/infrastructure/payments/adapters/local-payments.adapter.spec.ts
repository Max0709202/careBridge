import { Logger } from '@nestjs/common';

import { LocalPaymentsAdapter, readEvent } from './local-payments.adapter';
import { WebhookSignatureError, signatureHeader } from '../webhook-signature';
import { classifyDecline } from '../../../domain/dunning';

/**
 * The adapter that makes the unhappy path reachable without a Stripe account.
 *
 * The assertions worth having are the two properties the rest of the system
 * relies on: outcomes are chosen by the **card**, and identical inputs produce
 * identical references. Everything downstream — the payment table's unique
 * constraint, the idempotency key, the dunning branch — is built on those.
 */

const SECRET = 'local-webhook-secret';

// The adapter logs each scripted decline, which is useful when running the
// stack and pure noise here — and a hundred log lines between two failures is
// how a failing assertion becomes hard to find.
beforeAll(() => {
  Logger.overrideLogger(false);
});
afterAll(() => {
  Logger.overrideLogger(true);
});

function adapter(): LocalPaymentsAdapter {
  return new LocalPaymentsAdapter(SECRET);
}

async function refFor(token: string): Promise<string> {
  const card = await adapter().attachPaymentMethod({ customerRef: 'cus_1', token });
  return card.externalId;
}

function chargeWith(paymentMethodRef: string, key = 'inv:1:attempt:1') {
  return adapter().charge({
    amountCents: 2900,
    currency: 'usd',
    customerRef: 'cus_1',
    paymentMethodRef,
    idempotencyKey: key,
    description: 'CareBridge CB-001000',
  });
}

describe('customers', () => {
  it('reuses an existing reference rather than making a second one', async () => {
    const ref = await adapter().ensureCustomer({
      accountId: 'acct_1',
      email: 'a@example.com',
      existingRef: 'cus_existing',
    });
    expect(ref).toBe('cus_existing');
  });

  it('derives a stable reference from the account, so a retry is not a second customer', async () => {
    const first = await adapter().ensureCustomer({
      accountId: 'acct_1',
      email: 'a@example.com',
      existingRef: null,
    });
    const again = await adapter().ensureCustomer({
      accountId: 'acct_1',
      email: 'a@example.com',
      existingRef: null,
    });
    expect(first).toEqual(again);
  });
});

describe('cards', () => {
  it('keeps the last four from the token, because the outcome is chosen by them', async () => {
    const card = await adapter().attachPaymentMethod({
      customerRef: 'cus_1',
      token: 'tok_test_4242',
    });
    expect(card.last4).toBe('4242');
    expect(card.expYear).toBeGreaterThan(new Date().getUTCFullYear());
  });

  it('carries the last four inside the reference it mints', async () => {
    // `charge` is given only this reference. If the card's identity were not
    // in it, the scripted outcome would have to be recovered from a hash —
    // which is to say chosen at random, and the decline path would become
    // unreachable by choosing a card.
    expect(await refFor('tok_test_9995')).toMatch(/^pm_local_9995_/);
  });

  it('gives a token with no digits a stable stand-in rather than four zeroes', async () => {
    const first = await refFor('tok_no_digits_here');
    const again = await refFor('tok_no_digits_here');
    expect(first).toEqual(again);
    expect(first).toMatch(/^pm_local_\d{4}_/);
  });

  it('detaching holds nothing, so it cannot fail', async () => {
    await expect(adapter().detachPaymentMethod()).resolves.toBeUndefined();
  });
});

describe('charging', () => {
  it('settles an ordinary card', async () => {
    const outcome = await chargeWith(await refFor('tok_test_4242'));
    expect(outcome.status).toBe('succeeded');
  });

  it('settles a reference it did not mint, rather than declining it', async () => {
    // The safe default. A reference from elsewhere is not evidence of a bad
    // card, and declining it would fail a charge for the wrong reason.
    const outcome = await chargeWith('pm_from_somewhere_else');
    expect(outcome.status).toBe('succeeded');
  });

  it('declines a card with insufficient funds, retryably', async () => {
    const outcome = await chargeWith(await refFor('tok_test_9995'));
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');

    expect(outcome.failureCode).toBe('card_declined_insufficient_funds');
    expect(classifyDecline(outcome.failureCode)).toBe('retryable');
  });

  it('declines a stolen card terminally, so dunning stops at once', async () => {
    const outcome = await chargeWith(await refFor('tok_test_9979'));
    if (outcome.status !== 'failed') throw new Error('expected a decline');

    expect(classifyDecline(outcome.failureCode)).toBe('terminal');
  });

  it('declines an expired card retryably', async () => {
    const outcome = await chargeWith(await refFor('tok_test_0069'));
    if (outcome.status !== 'failed') throw new Error('expected a decline');

    expect(outcome.failureCode).toBe('expired_card');
    expect(classifyDecline(outcome.failureCode)).toBe('retryable');
  });

  it('leaves a card needing authentication pending, never failed', async () => {
    // Treating "we do not know" as "it did not work" retries a charge that may
    // already have succeeded. The webhook settles it instead.
    const outcome = await chargeWith(await refFor('tok_test_0341'));
    expect(outcome.status).toBe('pending');
  });

  it('derives the payment reference from the idempotency key, so a replay is one payment', async () => {
    const ref = await refFor('tok_test_4242');
    const first = await chargeWith(ref, 'inv:7:attempt:2');
    const replay = await chargeWith(ref, 'inv:7:attempt:2');
    const next = await chargeWith(ref, 'inv:7:attempt:3');

    expect(first.status).toBe('succeeded');
    if (first.status !== 'succeeded' || replay.status !== 'succeeded') {
      throw new Error('unreachable');
    }
    expect(replay.externalPaymentId).toEqual(first.externalPaymentId);
    if (next.status !== 'succeeded') throw new Error('unreachable');
    expect(next.externalPaymentId).not.toEqual(first.externalPaymentId);
  });

  it('refunds against a payment reference', async () => {
    const refund = await adapter().refund({
      externalPaymentId: 'pi_local_x',
      amountCents: 500,
      idempotencyKey: 'refund:1',
    });
    expect(refund.amountCents).toBe(500);
    expect(refund.externalRefundId).toMatch(/^re_local_/);
  });
});

describe('webhooks', () => {
  function body(payload: unknown): Buffer {
    return Buffer.from(JSON.stringify(payload));
  }

  function signed(raw: Buffer): string {
    return signatureHeader({
      rawBody: raw,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  it('verifies its own signatures rather than waving them through', () => {
    // The point of signing locally at all: the branch that rejects a forgery
    // is the same code in development as in production.
    const raw = body({ id: 'evt_1', type: 'payment_intent.succeeded' });
    expect(() => adapter().verifyWebhook(raw, 't=1,v1=deadbeef')).toThrow(
      WebhookSignatureError,
    );
    expect(() => adapter().verifyWebhook(raw, signed(raw))).not.toThrow();
  });

  it('refuses a body that is not JSON', () => {
    const raw = Buffer.from('not json at all');
    expect(() => adapter().verifyWebhook(raw, signed(raw))).toThrow(/not JSON/);
  });

  it('reads the fields the handler acts on', () => {
    const event = readEvent({
      id: 'evt_9',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_9',
          amount: 2900,
          last_payment_error: { code: 'expired_card', message: 'The card expired.' },
        },
      },
    });

    expect(event).toEqual({
      id: 'evt_9',
      type: 'payment_intent.payment_failed',
      externalPaymentId: 'pi_9',
      failureCode: 'expired_card',
      failureMessage: 'The card expired.',
      amountCents: 2900,
    });
  });

  it('reads an event with no payment object without inventing one', () => {
    const event = readEvent({ id: 'evt_10', type: 'customer.created' });
    expect(event.externalPaymentId).toBeNull();
    expect(event.failureCode).toBeNull();
    expect(event.amountCents).toBeNull();
  });

  it('refuses an event with no id or no type', () => {
    // Without an id there is nothing to claim, and the whole defence against
    // a redelivered "succeeded" crediting an account twice is the claim.
    expect(() => readEvent({ type: 'payment_intent.succeeded' })).toThrow(
      WebhookSignatureError,
    );
    expect(() => readEvent({ id: 'evt_11' })).toThrow(WebhookSignatureError);
    expect(() => readEvent(null)).toThrow(WebhookSignatureError);
  });
});
