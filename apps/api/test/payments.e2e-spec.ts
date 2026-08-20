import { TestHarness } from './support/harness';
import { authed, registerUser, verifyEmail } from './support/factories';
import { expectsAuthentication } from './support/negative-paths';
import { BillingCycleService } from '../src/modules/billing/billing-cycle.service';
import { signatureHeader } from '../src/infrastructure/payments/webhook-signature';

/**
 * The money actually moving.
 *
 * The local payments adapter decides an outcome from the card's last four
 * digits, using Stripe's own test-card meanings — `4242` settles, `9995` is
 * declined for insufficient funds, `9979` is reported stolen. That is what
 * makes the whole unhappy path reachable here without a Stripe account, and
 * it is the reason the adapter exists.
 *
 * The assertions that matter most are the ones about *not* charging twice: a
 * redelivered webhook, and two sweeps racing the same invoice.
 */

const WEBHOOK_SECRET = 'local-webhook-secret';

/** A card that settles. */
const GOOD_CARD = 'tok_test_4242';
/** Declined, retryable — the ordinary dunning path. */
const DECLINED_CARD = 'tok_test_9995';
/** Reported stolen. Terminal: retrying it cannot succeed. */
const STOLEN_CARD = 'tok_test_9979';

describe('payments', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  /** Registration starts a trial; this converts it so there is money to take. */
  async function household(card: string | null) {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);

    if (card) {
      await authed(harness, user.accessToken)
        .post('/api/v1/billing/payment-method')
        .set('Idempotency-Key', `card-${user.userId}`)
        .send({ token: card })
        .expect(201);
    }

    return user;
  }

  /** Drags the subscription's clock into the past so the sweep acts on it. */
  async function expireTrial(userId: string): Promise<void> {
    const account = await harness.prisma.billingAccount.findUniqueOrThrow({
      where: { ownerUserId: userId },
    });
    await harness.prisma.subscription.updateMany({
      where: { billingAccountId: account.id },
      data: { trialEndsAt: new Date(Date.now() - 60_000) },
    });
  }

  function sweep(now = new Date()) {
    return harness.app.get(BillingCycleService).run(now);
  }

  // ─── the bug this whole slice exists for ──────────────────────────────────

  describe('the subscription clock', () => {
    it('does not entitle a trial forever', async () => {
      // Before there was a clock, `isEntitling` answered true for `trialing`
      // unconditionally and nothing ever moved the row — so a fourteen-day
      // trial entitled live tracking permanently, and no period was ever
      // billed. Silent in both directions.
      const user = await household(GOOD_CARD);
      await expireTrial(user.userId);

      const result = await sweep();
      expect(result.converted).toBe(1);

      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });
      const subscription = await harness.prisma.subscription.findFirstOrThrow({
        where: { billingAccountId: account.id },
      });

      expect(subscription.status).toBe('active');
      expect(subscription.trialEndsAt).toBeNull();
      expect(subscription.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('bills the converted period and marks it paid', async () => {
      const user = await household(GOOD_CARD);
      await expireTrial(user.userId);
      await sweep();

      const invoices = await authed(harness, user.accessToken)
        .get('/api/v1/billing/invoices')
        .expect(200);

      const [invoice] = invoices.body as Array<{
        status: string;
        totalCents: number;
        amountPaidCents: number;
        number: string;
        lines: unknown[];
      }>;

      expect(invoice).toBeDefined();
      expect(invoice?.status).toBe('paid');
      expect(invoice?.totalCents).toBe(2900);
      expect(invoice?.amountPaidCents).toBe(2900);
      // Human-quotable: an invoice somebody rings up about must be findable by
      // the number printed on it.
      expect(invoice?.number).toMatch(/^CB-\d{6}$/);
      expect(invoice?.lines.length).toBeGreaterThan(0);
    });

    it('renews a period that has ended, anchored to the boundary rather than to now', async () => {
      const user = await household(GOOD_CARD);
      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });

      const boundary = new Date('2026-06-01T00:00:00Z');
      await harness.prisma.subscription.updateMany({
        where: { billingAccountId: account.id },
        data: {
          status: 'active',
          trialEndsAt: null,
          currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
          currentPeriodEnd: boundary,
        },
      });

      // Deliberately late. A sweep running forty minutes after the boundary
      // must not move the renewal date, or a subscriber bought on the 1st is
      // billed on the 9th by December.
      const result = await sweep(new Date('2026-06-01T00:40:00Z'));
      expect(result.renewed).toBe(1);

      const subscription = await harness.prisma.subscription.findFirstOrThrow({
        where: { billingAccountId: account.id },
      });
      expect(subscription.currentPeriodStart).toEqual(boundary);
      expect(subscription.currentPeriodEnd).toEqual(new Date('2026-07-01T00:00:00Z'));
    });

    it('completes a cancellation once the paid period ends, and not before', async () => {
      const user = await household(GOOD_CARD);
      await authed(harness, user.accessToken)
        .post('/api/v1/billing/cancel')
        .expect(201);

      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });

      // Still inside the period they paid for: nothing happens, and the plan
      // keeps working. Cancelling is not a refund.
      expect((await sweep()).canceled).toBe(0);

      await harness.prisma.subscription.updateMany({
        where: { billingAccountId: account.id },
        data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
      });

      expect((await sweep()).canceled).toBe(1);
      const subscription = await harness.prisma.subscription.findFirstOrThrow({
        where: { billingAccountId: account.id },
      });
      expect(subscription.status).toBe('canceled');
    });
  });

  // ─── declines ─────────────────────────────────────────────────────────────

  describe('a declined card', () => {
    it('moves the subscription past due and keeps entitling through grace', async () => {
      const user = await household(DECLINED_CARD);
      await expireTrial(user.userId);
      await sweep();

      const billing = await authed(harness, user.accessToken)
        .get('/api/v1/billing/account')
        .expect(200);

      const body = billing.body as {
        amountDueCents: number;
        subscription: { status: string; entitlements: string[] };
      };

      expect(body.subscription.status).toBe('pastDue');
      expect(body.amountDueCents).toBe(2900);
      // The whole reason the grace window is not zero: the map stays on while
      // this is sorted out, rather than blanking mid-journey.
      expect(body.subscription.entitlements).toContain('liveTracking');
    });

    it('schedules a retry and emails without saying anything has stopped', async () => {
      const user = await household(DECLINED_CARD);
      await expireTrial(user.userId);
      await sweep();

      const invoice = await harness.prisma.invoice.findFirstOrThrow({});
      expect(invoice.status).toBe('open');
      expect(invoice.attemptCount).toBe(1);
      expect(invoice.nextAttemptAt).not.toBeNull();
      expect(invoice.lastFailureCode).toBe('card_declined_insufficient_funds');

      const mail = harness.mail.sent.find((m) => m.subject.includes('did not go'));
      expect(mail).toBeDefined();
      expect(mail?.text).toContain('Nothing has been switched off');
    });

    it('walks the retry schedule and stops, rather than retrying forever', async () => {
      // The bug this pins: `recordFailure` used to derive the attempt number
      // from the invoice snapshot read *before* the attempt was claimed, which
      // is one behind. Every failure then looked like attempt one, so the next
      // attempt was always the first offset — a dead card presented to an
      // issuer a day later, indefinitely, with the schedule never exhausting.
      const user = await household(DECLINED_CARD);
      await expireTrial(user.userId);
      await sweep();

      const first = await harness.prisma.invoice.findFirstOrThrow({});
      const failedAt = first.firstFailedAt;
      expect(failedAt).not.toBeNull();
      if (!failedAt) throw new Error('unreachable');

      const days = (value: Date | null) =>
        value == null
          ? null
          : Math.round((value.getTime() - failedAt.getTime()) / 86_400_000);

      // +1, +3, +6 — each measured from the first failure, not from the
      // attempt before it, and all three inside the seven-day grace window.
      expect(days(first.nextAttemptAt)).toBe(1);

      const offsets: Array<number | null> = [];
      for (let attempt = 2; attempt <= 4; attempt += 1) {
        const due = await harness.prisma.invoice.findFirstOrThrow({});
        if (!due.nextAttemptAt) break;
        await sweep(new Date(due.nextAttemptAt.getTime() + 1_000));
        const after = await harness.prisma.invoice.findFirstOrThrow({});
        offsets.push(days(after.nextAttemptAt));
      }

      expect(offsets).toEqual([3, 6, null]);

      const exhausted = await harness.prisma.invoice.findFirstOrThrow({});
      expect(exhausted.attemptCount).toBe(4);
      expect(exhausted.status).toBe('uncollectible');
    });

    it('gives up at once on a card reported stolen', async () => {
      // Three more attempts over six days cannot succeed, and each one is a
      // fraud signal recorded against us.
      const user = await household(STOLEN_CARD);
      await expireTrial(user.userId);
      await sweep();

      const invoice = await harness.prisma.invoice.findFirstOrThrow({});
      expect(invoice.status).toBe('uncollectible');
      expect(invoice.nextAttemptAt).toBeNull();
      expect(invoice.attemptCount).toBe(1);
    });

    it('expires the subscription once the grace window closes', async () => {
      const user = await household(DECLINED_CARD);
      await expireTrial(user.userId);
      await sweep();

      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });

      // Eight days on: past the seven-day family grace, and past every
      // scheduled retry — which is why the schedule is pinned inside it.
      const later = new Date(Date.now() + 8 * 24 * 3_600_000);
      const result = await sweep(later);
      expect(result.expired).toBe(1);

      const subscription = await harness.prisma.subscription.findFirstOrThrow({
        where: { billingAccountId: account.id },
      });
      expect(subscription.status).toBe('expired');
    });

    it('recovers the subscription when a replaced card is charged on demand', async () => {
      const user = await household(DECLINED_CARD);
      await expireTrial(user.userId);
      await sweep();

      await authed(harness, user.accessToken)
        .post('/api/v1/billing/payment-method')
        .set('Idempotency-Key', `card-fixed-${user.userId}`)
        .send({ token: GOOD_CARD })
        .expect(201);

      const invoice = await harness.prisma.invoice.findFirstOrThrow({});
      const paid = await authed(harness, user.accessToken)
        .post(`/api/v1/billing/invoices/${invoice.id}/pay`)
        .expect(201);

      expect((paid.body as { status: string }).status).toBe('paid');

      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });
      const subscription = await harness.prisma.subscription.findFirstOrThrow({
        where: { billingAccountId: account.id },
      });
      expect(subscription.status).toBe('active');
      expect(subscription.pastDueSince).toBeNull();
    });

    it('dunns an account with no card at all, rather than crashing', async () => {
      const user = await household(null);
      await expireTrial(user.userId);
      await sweep();

      const invoice = await harness.prisma.invoice.findFirstOrThrow({});
      expect(invoice.lastFailureCode).toBe('no_payment_method');
      expect(invoice.status).toBe('open');
    });
  });

  // ─── not charging twice ───────────────────────────────────────────────────

  describe('a retried request is not a second charge', () => {
    it('does not re-collect an invoice a second sweep sees', async () => {
      const user = await household(GOOD_CARD);
      await expireTrial(user.userId);
      await sweep();
      await sweep();

      const payments = await harness.prisma.payment.findMany({});
      expect(payments).toHaveLength(1);
      expect(payments[0]?.status).toBe('succeeded');
    });

    it('opens exactly one period when two sweeps race the same renewal', async () => {
      const user = await household(GOOD_CARD);
      await expireTrial(user.userId);

      // Concurrent, sharing the optimistic version guard on the row. Exactly
      // one may win — two periods would mean two invoices for one month.
      await Promise.all([sweep(), sweep()]);

      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });
      const subscription = await harness.prisma.subscription.findFirstOrThrow({
        where: { billingAccountId: account.id },
      });
      const periods = await harness.prisma.subscriptionPeriod.findMany({
        where: { subscriptionId: subscription.id },
      });

      // Period 0 was written when the trial opened; the conversion adds one.
      expect(periods).toHaveLength(2);
      const invoices = await harness.prisma.invoice.findMany({});
      expect(invoices).toHaveLength(1);
    });
  });

  // ─── the processor calling back ───────────────────────────────────────────

  describe('webhooks', () => {
    function post(body: unknown, secret = WEBHOOK_SECRET) {
      const raw = Buffer.from(JSON.stringify(body));
      const timestamp = Math.floor(Date.now() / 1000);

      // Sent as a string, not the Buffer. Superagent's JSON serialiser would
      // turn a Buffer into `{"type":"Buffer","data":[…]}`, and the signature is
      // over the exact bytes — so the test would be signing one body and
      // sending another.
      return harness.http
        .post('/api/v1/billing/webhooks/payments')
        .set('stripe-signature', signatureHeader({ rawBody: raw, secret, timestamp }))
        .set('content-type', 'application/json')
        .send(raw.toString('utf8'));
    }

    it('refuses an unsigned callback', async () => {
      // Unsigned, this endpoint is an unauthenticated POST that marks any
      // invoice paid — and its URL is not a secret.
      await harness.http
        .post('/api/v1/billing/webhooks/payments')
        .send({ id: 'evt_1', type: 'payment_intent.succeeded' })
        .expect(400);
    });

    it('refuses a callback signed with the wrong secret', async () => {
      await post(
        {
          id: 'evt_2',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_x' } },
        },
        'not-the-secret',
      ).expect(400);
    });

    it('settles a pending payment', async () => {
      const user = await household(null);
      await expireTrial(user.userId);
      await sweep();

      const invoice = await harness.prisma.invoice.findFirstOrThrow({});
      // Stand in for a charge the processor took but had not settled when the
      // call returned — the `pending` outcome the port models explicitly.
      const payment = await harness.prisma.payment.findFirstOrThrow({});
      await harness.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'pending', externalPaymentId: 'pi_settled_1' },
      });

      await post({
        id: 'evt_settle_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_settled_1' } },
      }).expect(200);

      const settled = await harness.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(settled.status).toBe('paid');
      expect(settled.amountPaidCents).toBe(settled.totalCents);
    });

    it('credits an account once when the same event is delivered twice', async () => {
      // Redelivery is documented processor behaviour, not failure. Without the
      // unique claim on the event id, the second pass marks the invoice paid
      // again and the ledger drifts from the bank by one period.
      const user = await household(null);
      await expireTrial(user.userId);
      await sweep();

      const payment = await harness.prisma.payment.findFirstOrThrow({});
      await harness.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'pending', externalPaymentId: 'pi_dupe_1' },
      });

      const event = {
        id: 'evt_dupe_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_dupe_1' } },
      };

      await post(event).expect(200);
      await post(event).expect(200);

      const events = await harness.prisma.processorEvent.findMany({});
      expect(events).toHaveLength(1);

      const payments = await harness.prisma.payment.findMany({});
      expect(payments.filter((p) => p.status === 'succeeded')).toHaveLength(1);
    });

    it('answers 200 to an event type it does not handle', async () => {
      // A processor retries non-2xx for days and eventually disables the
      // endpoint — which silently stops the events we *do* handle.
      await post({
        id: 'evt_unknown_1',
        type: 'customer.subscription.trial_will_end',
        data: { object: { id: 'sub_x' } },
      }).expect(200);

      const recorded = await harness.prisma.processorEvent.findFirstOrThrow({
        where: { externalEventId: 'evt_unknown_1' },
      });
      expect(recorded.skippedReason).toContain('unhandled');
    });
  });

  // ─── who may see what ─────────────────────────────────────────────────────

  describe('access', () => {
    it('needs authentication for every billing surface', async () => {
      await expectsAuthentication((token) =>
        authed(harness, token).get('/api/v1/billing/invoices'),
      );
      await expectsAuthentication((token) =>
        authed(harness, token)
          .post('/api/v1/billing/payment-method')
          .send({ token: GOOD_CARD }),
      );
    });

    it('does not show one household another household’s invoices', async () => {
      const mine = await household(GOOD_CARD);
      await expireTrial(mine.userId);
      await sweep();

      const stranger = await registerUser(harness);
      const response = await authed(harness, stranger.accessToken)
        .get('/api/v1/billing/invoices')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('refuses to charge an invoice that belongs to somebody else', async () => {
      const mine = await household(DECLINED_CARD);
      await expireTrial(mine.userId);
      await sweep();
      const invoice = await harness.prisma.invoice.findFirstOrThrow({});

      const stranger = await registerUser(harness);
      // The same 404 as "no such invoice": an id is never a capability, and the
      // error must not be usable to probe for one.
      await authed(harness, stranger.accessToken)
        .post(`/api/v1/billing/invoices/${invoice.id}/pay`)
        .expect(404);
    });
  });

  // ─── cards ────────────────────────────────────────────────────────────────

  describe('cards on file', () => {
    it('keeps at most one default, and the newest wins', async () => {
      const user = await household(GOOD_CARD);

      await authed(harness, user.accessToken)
        .post('/api/v1/billing/payment-method')
        .set('Idempotency-Key', `second-${user.userId}`)
        .send({ token: DECLINED_CARD })
        .expect(201);

      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });
      const defaults = await harness.prisma.paymentMethod.findMany({
        where: { billingAccountId: account.id, isDefault: true },
      });

      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.last4).toBe('9995');
    });

    it('detaches without deleting, so an old payment still names its card', async () => {
      const user = await household(GOOD_CARD);
      const billing = await authed(harness, user.accessToken)
        .get('/api/v1/billing/account')
        .expect(200);

      const card = (billing.body as { paymentMethod: { id: string } }).paymentMethod;
      expect(card).not.toBeNull();

      await authed(harness, user.accessToken)
        .delete(`/api/v1/billing/payment-method/${card.id}`)
        .expect(204);

      const row = await harness.prisma.paymentMethod.findUniqueOrThrow({
        where: { id: card.id },
      });
      expect(row.detachedAt).not.toBeNull();
      expect(row.isDefault).toBe(false);
    });

    it('never stores anything that could be a card number', async () => {
      const user = await household(GOOD_CARD);
      const rows = await harness.prisma.paymentMethod.findMany({});

      for (const row of rows) {
        expect(row.last4).toHaveLength(4);
        // The processor's token, not a PAN. Asserted so that a future adapter
        // cannot start round-tripping the number through this column.
        expect(row.externalId).not.toMatch(/^\d{13,19}$/);
      }
      expect(rows.length).toBeGreaterThan(0);
      expect(user.userId).toBeDefined();
    });
  });
});
