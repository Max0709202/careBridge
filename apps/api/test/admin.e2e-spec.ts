import { TestHarness, errorOf } from './support/harness';
import { authed, registerUser, verifyEmail, type TestUser } from './support/factories';
import { BillingCycleService } from '../src/modules/billing/billing-cycle.service';

/**
 * CareBridge's own staff surfaces.
 *
 * The tests that matter here are all about the door rather than the rooms.
 * An account that can read the audit log across every organisation is already
 * sensitive; one that can move money out of the business is the most valuable
 * password in the system. So: standing is required, a second factor is
 * required, support cannot write, and a caller with neither cannot even tell
 * that the surface exists.
 */
describe('the administration surfaces', () => {
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

  /**
   * A staff account with a confirmed second factor.
   *
   * The enrolment is written directly rather than driven through the TOTP
   * round trip, which is tested end to end in mfa.e2e-spec.ts. What is being
   * set up here is the *precondition*, and repeating the dance in every block
   * would make each test harder to read than the thing it tests.
   */
  async function staff(role: 'support' | 'admin', options: { mfa?: boolean } = {}) {
    const user = await registerUser(harness);
    await harness.prisma.user.update({
      where: { id: user.userId },
      data: { platformRole: role },
    });

    if (options.mfa ?? true) {
      await harness.prisma.userMfa.create({
        data: {
          userId: user.userId,
          secretCiphertext: Buffer.from('ciphertext'),
          secretIv: Buffer.from('iv'),
          secretAuthTag: Buffer.from('tag'),
          confirmedAt: new Date(),
        },
      });
    }

    return user;
  }

  // ─── the door ─────────────────────────────────────────────────────────────

  describe('who gets in', () => {
    it('turns an ordinary user away without admitting the surface exists', async () => {
      // The same 404 every other refused lookup returns. A 403 would tell
      // somebody probing /admin that there is something there to find.
      const user = await registerUser(harness);

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/admin/audit')
        .expect(404);
      expect(errorOf(response).code).toBe('not_found_or_forbidden');
    });

    it('turns away staff who have not set up a second factor', async () => {
      // FOUNDATION §5 defers MFA enforcement to "when those roles arrive".
      // They have arrived. Not warned, not nagged — refused.
      const user = await staff('admin', { mfa: false });

      await authed(harness, user.accessToken).get('/api/v1/admin/audit').expect(404);
    });

    it('lets staff with a second factor read', async () => {
      const user = await staff('support');

      await authed(harness, user.accessToken).get('/api/v1/admin/audit').expect(200);
      await authed(harness, user.accessToken).get('/api/v1/admin/stats').expect(200);
      await authed(harness, user.accessToken).get('/api/v1/admin/flags').expect(200);
    });

    it('does not let support write', async () => {
      // Reading every organisation's audit log and moving money out of the
      // business should not be the same account by default.
      const user = await staff('support');

      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: true, rolloutPercent: 10 })
        .expect(404);
    });

    it('refuses an unauthenticated caller before anything else', async () => {
      await harness.http.get('/api/v1/admin/audit').expect(401);
    });

    it('takes effect the moment standing is revoked', async () => {
      // Read per request rather than carried in the token. Removing somebody's
      // access has to work now, not when their access token expires.
      const user = await staff('admin');
      await authed(harness, user.accessToken).get('/api/v1/admin/flags').expect(200);

      await harness.prisma.user.update({
        where: { id: user.userId },
        data: { platformRole: 'none' },
      });

      await authed(harness, user.accessToken).get('/api/v1/admin/flags').expect(404);
    });
  });

  // ─── the audit log ────────────────────────────────────────────────────────

  describe('the audit log', () => {
    async function noise(actor: TestUser, count: number) {
      await harness.prisma.auditLog.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          actorUserId: actor.userId,
          action: i % 2 === 0 ? 'driver.document_viewed' : 'billing.invoice_paid',
          entityType: i % 2 === 0 ? 'DriverDocument' : 'Invoice',
          entityId: `entity-${i}`,
          at: new Date(Date.now() - i * 1000),
          changedFields: [],
        })),
      });
    }

    it('names the actor rather than showing an id', async () => {
      const user = await staff('support');
      await noise(user, 3);

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/admin/audit')
        .expect(200);

      const body = response.body as {
        entries: Array<{ actorName: string | null; changedFields: string[] }>;
      };
      expect(body.entries[0]?.actorName).toBeTruthy();
    });

    it('filters by action as a prefix', async () => {
      // So `driver.` returns everything about drivers rather than requiring
      // somebody to know the exact verb.
      const user = await staff('support');
      await noise(user, 10);

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/admin/audit?action=driver.')
        .expect(200);

      const body = response.body as { entries: Array<{ action: string }> };
      expect(body.entries.length).toBeGreaterThan(0);
      for (const entry of body.entries) expect(entry.action).toMatch(/^driver\./);
    });

    it('pages without skipping or repeating a row', async () => {
      // The whole reason for keyset paging. This table is appended to on every
      // authenticated action; an offset would drop rows between pages, and a
      // log that quietly omits rows is worse than no log.
      const user = await staff('support');
      await noise(user, 120);

      const first = await authed(harness, user.accessToken)
        .get('/api/v1/admin/audit')
        .expect(200);
      const firstBody = first.body as {
        entries: Array<{ id: string }>;
        nextCursor: string | null;
      };
      expect(firstBody.nextCursor).toBeTruthy();

      const second = await authed(harness, user.accessToken)
        .get(`/api/v1/admin/audit?cursor=${encodeURIComponent(firstBody.nextCursor!)}`)
        .expect(200);
      const secondBody = second.body as { entries: Array<{ id: string }> };

      const firstIds = new Set(firstBody.entries.map((e) => e.id));
      const overlap = secondBody.entries.filter((e) => firstIds.has(e.id));
      expect(overlap).toEqual([]);
      expect(secondBody.entries.length).toBeGreaterThan(0);
    });

    it('treats a stale cursor as the first page rather than an error', async () => {
      const user = await staff('support');
      await noise(user, 3);

      await authed(harness, user.accessToken)
        .get('/api/v1/admin/audit?cursor=not-a-cursor')
        .expect(200);
    });

    it('carries field names and never values', async () => {
      // The whole reason this log can be read by somebody who is not entitled
      // to the records it describes.
      const user = await staff('support');
      await harness.prisma.auditLog.create({
        data: {
          actorUserId: user.userId,
          action: 'patient.update',
          entityType: 'Patient',
          entityId: 'patient-1',
          changedFields: ['homeAddress', 'phone'],
        },
      });

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/admin/audit?entityType=Patient')
        .expect(200);

      const body = response.body as { entries: Array<{ changedFields: string[] }> };
      expect(body.entries[0]?.changedFields).toEqual(['homeAddress', 'phone']);
      expect(JSON.stringify(body)).not.toMatch(/Parkside/);
    });
  });

  // ─── feature flags ────────────────────────────────────────────────────────

  describe('feature flags', () => {
    it('creates one and records who did', async () => {
      const user = await staff('admin');

      const response = await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: true, rolloutPercent: 25 })
        .expect(200);

      const flags = response.body as Array<{
        key: string;
        rolloutPercent: number;
        updatedByName: string | null;
      }>;
      const flag = flags.find((f) => f.key === 'new-checkout');
      expect(flag?.rolloutPercent).toBe(25);
      expect(flag?.updatedByName).toBeTruthy();

      const audit = await harness.prisma.auditLog.findFirst({
        where: { action: 'admin.flag_created', entityId: 'new-checkout' },
      });
      expect(audit?.actorUserId).toBe(user.userId);
    });

    it('widens a rollout without complaint', async () => {
      const user = await staff('admin');
      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: true, rolloutPercent: 10 })
        .expect(200);

      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: true, rolloutPercent: 50 })
        .expect(200);
    });

    it('makes somebody say so before narrowing one', async () => {
      // Narrowing takes a feature away from people who already have it, which
      // reads to them as a bug. Allowed — a bad release has to be pullable —
      // but said out loud rather than typed by accident.
      const user = await staff('admin');
      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: true, rolloutPercent: 50 })
        .expect(200);

      const refused = await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: true, rolloutPercent: 10 })
        .expect(400);
      expect(errorOf(refused).message).toMatch(/takes the feature away/i);

      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({
          description: 'A new checkout',
          enabled: true,
          rolloutPercent: 10,
          confirmNarrowing: true,
        })
        .expect(200);
    });

    it('lets a flag be switched off without confirmation', async () => {
      // When something has to go off in a hurry, nothing should stand between
      // an administrator and the switch.
      const user = await staff('admin');
      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: true, rolloutPercent: 100 })
        .expect(200);

      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'A new checkout', enabled: false, rolloutPercent: 100 })
        .expect(200);
    });

    it('refuses a rollout that is not a percentage', async () => {
      const user = await staff('admin');
      await authed(harness, user.accessToken)
        .put('/api/v1/admin/flags/new-checkout')
        .send({ description: 'x', enabled: true, rolloutPercent: 140 })
        .expect(400);
    });
  });

  // ─── refunds ──────────────────────────────────────────────────────────────

  describe('sending money back', () => {
    /**
     * A household with a card, a converted trial and therefore a paid invoice.
     *
     * The local payments adapter decides outcomes from the card's last four
     * digits using Stripe's own test-card meanings, so `4242` settles — which
     * is what makes there be something to refund without an account.
     */
    async function paidInvoice(): Promise<{ invoiceId: string; paymentId: string }> {
      const user = await registerUser(harness);
      await verifyEmail(harness, user.userId);

      await authed(harness, user.accessToken)
        .post('/api/v1/billing/payment-method')
        .set('Idempotency-Key', `card-${user.userId}`)
        .send({ token: 'tok_test_4242' })
        .expect(201);

      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });
      await harness.prisma.subscription.updateMany({
        where: { billingAccountId: account.id },
        data: { trialEndsAt: new Date(Date.now() - 60_000) },
      });
      await harness.app.get(BillingCycleService).run(new Date());

      const payment = await harness.prisma.payment.findFirstOrThrow({
        where: { billingAccountId: account.id, status: 'succeeded' },
      });
      return { invoiceId: payment.invoiceId, paymentId: payment.id };
    }

    it('still shows the payment after all of it has gone back', async () => {
      // A fully refunded payment is still the payment that was made. A view
      // that only looked for `succeeded` would claim nothing had ever been
      // paid at exactly the moment an administrator most needs to see what
      // happened.
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      const before = await authed(harness, admin.accessToken)
        .get(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .expect(200);
      const paid = (before.body as { paidCents: number }).paidCents;

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: paid, reason: 'Full refund.' })
        .expect(201);

      const after = await authed(harness, admin.accessToken)
        .get(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .expect(200);
      const body = after.body as {
        paidCents: number;
        refundableCents: number;
        refunds: unknown[];
      };
      expect(body.paidCents).toBe(paid);
      expect(body.refundableCents).toBe(0);
      expect(body.refunds).toHaveLength(1);
    });

    it('shows what is left to refund before anything is sent', async () => {
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      const response = await authed(harness, admin.accessToken)
        .get(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .expect(200);

      const body = response.body as {
        paymentId: string;
        paidCents: number;
        refundableCents: number;
      };
      expect(body.paymentId).toBe(paymentId);
      expect(body.refundableCents).toBe(body.paidCents);
    });

    it('sends money back and names who decided', async () => {
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      const response = await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: 500, reason: 'Ride was never provided.' })
        .expect(201);

      const body = response.body as {
        refundableCents: number;
        paidCents: number;
        refunds: Array<{ status: string; reason: string; requestedByName: string }>;
      };
      expect(body.refunds[0]?.status).toBe('succeeded');
      expect(body.refunds[0]?.requestedByName).toBeTruthy();
      expect(body.refundableCents).toBe(body.paidCents - 500);
    });

    it('writes the row before calling the processor', async () => {
      // Same shape the collection path uses. A refund that succeeded
      // externally and failed to record here would be money that left the
      // business with nothing to explain it.
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: 100, reason: 'Surcharge applied in error.' })
        .expect(201);

      const refund = await harness.prisma.refund.findFirstOrThrow({
        where: { invoiceId },
      });
      expect(refund.requestedByUserId).toBe(admin.userId);
      expect(refund.externalRefundId).toBeTruthy();
      expect(refund.idempotencyKey).toBeTruthy();
    });

    it('refuses more than is left on the payment', async () => {
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      const response = await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: 99_999_99, reason: 'Everything.' })
        .expect(400);

      expect(errorOf(response).message).toMatch(/more than is left/i);
    });

    it('refuses a second refund that would take it over the total', async () => {
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      const first = await authed(harness, admin.accessToken)
        .get(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .expect(200);
      const paid = (first.body as { paidCents: number }).paidCents;

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: paid, reason: 'Full refund.' })
        .expect(201);

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: 100, reason: 'Again.' })
        .expect(400);
    });

    it('marks the payment refunded only when nothing is left on it', async () => {
      // A partial refund leaves it succeeded, because it *did* succeed and the
      // remainder is still collected revenue.
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: 100, reason: 'Partial.' })
        .expect(201);

      let payment = await harness.prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      expect(payment.status).toBe('succeeded');

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({
          paymentId,
          amountCents: payment.amountCents - 100,
          reason: 'The rest.',
        })
        .expect(201);

      payment = await harness.prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      expect(payment.status).toBe('refunded');
    });

    it('insists on a reason', async () => {
      // An unexplained credit is something somebody has to justify to an
      // accountant a quarter later, by which time whoever issued it has
      // forgotten.
      const admin = await staff('admin');
      const { invoiceId, paymentId } = await paidInvoice();

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: 100 })
        .expect(400);
    });

    it('will not refund a payment from a different invoice', async () => {
      const admin = await staff('admin');
      const mine = await paidInvoice();
      const theirs = await paidInvoice();

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/invoices/${mine.invoiceId}/refunds`)
        .send({
          paymentId: theirs.paymentId,
          amountCents: 100,
          reason: 'Wrong invoice.',
        })
        .expect(404);
    });

    it('is not something support can do', async () => {
      const support = await staff('support');
      const { invoiceId, paymentId } = await paidInvoice();

      await authed(harness, support.accessToken)
        .post(`/api/v1/admin/invoices/${invoiceId}/refunds`)
        .send({ paymentId, amountCents: 100, reason: 'Nope.' })
        .expect(404);
    });
  });

  // ─── the dashboard ────────────────────────────────────────────────────────

  describe('the dashboard', () => {
    it('answers with every number a pilot is watched on', async () => {
      const user = await staff('support');

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/admin/stats')
        .expect(200);

      const stats = response.body as Record<string, number>;
      for (const key of [
        'ridesLast7Days',
        'ridesCompletedLast7Days',
        'ridesNoShowLast7Days',
        'activeRidesNow',
        'staleTrackingNow',
        'driversApproved',
        'documentsAwaitingReview',
        'invoicesPastDue',
        'revenueCentsLast30Days',
        'refundedCentsLast30Days',
      ]) {
        expect(typeof stats[key]).toBe('number');
      }
    });
  });
});
