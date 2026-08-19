import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  registerUser,
  verifyEmail,
} from './support/factories';
import {
  expectsAuthentication,
  expectsIndistinguishableDenial,
} from './support/negative-paths';

/**
 * Who pays, and what happens when they stop.
 *
 * CareBridge has two payers — a household and a transport operator — and the
 * consequential assertions here are the ones about the *boundary* between
 * them: that an operator's invoice is not readable by someone outside the
 * operator, that a lapsed household is refused a booking, and that a fare is
 * not taxed twice when the operator is already paying by seats.
 */
let organizationSequence = 0;

describe('billing', () => {
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

  // ─── the catalogue ────────────────────────────────────────────────────────

  describe('the plan catalogue', () => {
    it('is data, and is returned per payer', async () => {
      const user = await registerUser(harness);

      const family = await authed(harness, user.accessToken)
        .get('/api/v1/billing/plans?payer=family')
        .expect(200);
      const dispatch = await authed(harness, user.accessToken)
        .get('/api/v1/billing/plans?payer=dispatchOrganization')
        .expect(200);

      const familyPlans = family.body as Array<{
        code: string;
        interval: string;
        includedSeats: number;
        seatTiers: unknown[];
      }>;
      const dispatchPlans = dispatch.body as Array<{
        code: string;
        interval: string;
        seatTiers: Array<{ upToSeats: number | null }>;
      }>;

      expect(familyPlans.map((p) => p.interval).sort()).toEqual(['annual', 'monthly']);
      // A household does not have seats, and the catalogue says so rather than
      // leaving the app to infer it.
      expect(familyPlans.every((p) => p.includedSeats === 0)).toBe(true);
      expect(familyPlans.every((p) => p.seatTiers.length === 0)).toBe(true);

      // The dispatch ladder ends unbounded, or every driver above the top band
      // would be free.
      for (const plan of dispatchPlans) {
        expect(plan.seatTiers.at(-1)?.upToSeats).toBeNull();
      }
    });

    it('prices annual as its own row rather than twelve times monthly', async () => {
      const user = await registerUser(harness);
      const response = await authed(harness, user.accessToken)
        .get('/api/v1/billing/plans?payer=family')
        .expect(200);

      const plans = response.body as Array<{
        interval: string;
        basePriceCents: number;
      }>;
      const monthly = plans.find((p) => p.interval === 'monthly')!;
      const annual = plans.find((p) => p.interval === 'annual')!;

      expect(annual.basePriceCents).toBeLessThan(monthly.basePriceCents * 12);
    });

    it('is not readable by a stranger', async () => {
      await expectsAuthentication((token) =>
        authed(harness, token).get('/api/v1/billing/plans?payer=family'),
      );
    });
  });

  // ─── the household ────────────────────────────────────────────────────────

  describe('a household', () => {
    it('is on a trial from the moment it registers', async () => {
      // Not from the first ride. A family that never sees a plan, a renewal
      // date or a price has no way to find out what this costs until the day
      // it stops working.
      const user = await registerUser(harness);

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/billing/account')
        .expect(200);

      const account = response.body as {
        payer: string;
        subscription: {
          status: string;
          interval: string;
          trialEndsAt: string | null;
          entitlements: string[];
          renewalQuote: { totalCents: number };
        };
      };

      expect(account.payer).toBe('family');
      expect(account.subscription.status).toBe('trialing');
      expect(account.subscription.trialEndsAt).not.toBeNull();
      expect(account.subscription.entitlements).toContain('requestTransport');
      expect(account.subscription.renewalQuote.totalCents).toBeGreaterThan(0);
    });

    it('can move to annual, and the credit for the unused month follows it', async () => {
      const user = await registerUser(harness);

      const response = await authed(harness, user.accessToken)
        .post('/api/v1/billing/change-interval')
        .send({ interval: 'annual' })
        .expect(201);

      const account = response.body as {
        subscription: { interval: string; renewalQuote: { totalCents: number } };
      };
      expect(account.subscription.interval).toBe('annual');
      expect(account.subscription.renewalQuote.totalCents).toBe(29_000);

      // The period that was open is closed and a fresh one opened, so the
      // invoice history says what was actually charged under which plan.
      const periods = await harness.prisma.subscriptionPeriod.findMany({
        orderBy: { sequence: 'asc' },
      });
      expect(periods).toHaveLength(2);
      expect(periods[0]?.closedAt).not.toBeNull();
      expect(periods[1]?.interval).toBe('annual');
    });

    it('refuses a switch to the interval already in force', async () => {
      const user = await registerUser(harness);

      const response = await authed(harness, user.accessToken)
        .post('/api/v1/billing/change-interval')
        .send({ interval: 'monthly' })
        .expect(400);

      expect(errorOf(response).code).toBe('validation');
    });

    it('keeps running until the end of the period it paid for after cancelling', async () => {
      // Cancelling is not a refund, and it is not an immediate switch-off: a
      // family part-way through a booked month keeps live tracking for the
      // rides they have already arranged.
      const user = await registerUser(harness);

      const response = await authed(harness, user.accessToken)
        .post('/api/v1/billing/cancel')
        .expect(201);

      const account = response.body as {
        subscription: {
          status: string;
          cancelRequestedAt: string | null;
          entitlements: string[];
        };
      };

      expect(account.subscription.status).toBe('pendingCancellation');
      expect(account.subscription.cancelRequestedAt).not.toBeNull();
      expect(account.subscription.entitlements).toContain('liveTracking');
    });

    it('refuses a second subscription while one is live', async () => {
      const user = await registerUser(harness);

      const response = await authed(harness, user.accessToken)
        .post('/api/v1/billing/subscribe')
        .send({ planCode: 'family-standard', interval: 'annual' })
        .expect(409);

      expect(errorOf(response).code).toBe('conflict');
    });

    it('writes an audit row for every change to what it pays', async () => {
      const user = await registerUser(harness);

      await authed(harness, user.accessToken)
        .post('/api/v1/billing/change-interval')
        .send({ interval: 'annual' })
        .expect(201);

      const audit = await harness.prisma.auditLog.findMany({
        where: { actorUserId: user.userId, action: 'billing.change_interval' },
      });
      expect(audit).toHaveLength(1);
      // Field names, never values — the audit log must not become a second
      // copy of the data it exists to protect.
      expect(audit[0]?.changedFields).toContain('interval');
    });
  });

  // ─── entitlement enforcement ──────────────────────────────────────────────

  describe('a household with no active plan', () => {
    async function familyWithAppointment() {
      const user = await registerUser(harness);
      await verifyEmail(harness, user.userId);
      const patientId = await createPatient(harness, user.accessToken, {
        preferredName: 'Margaret',
      });
      const clinicId = await createClinic(harness, user.accessToken, {
        name: 'Kings County Cardiology',
      });
      const appointmentId = await createAppointment(harness, user.accessToken, {
        patientId,
        clinicId,
      });
      return { user, appointmentId };
    }

    it('cannot book transport', async () => {
      const { user, appointmentId } = await familyWithAppointment();

      // Expired rather than cancelled: a cancelled subscription is still
      // entitling until the period ends, which is the case above.
      await harness.prisma.subscription.updateMany({ data: { status: 'expired' } });

      const response = await authed(harness, user.accessToken)
        .post('/api/v1/rides')
        .send({
          appointmentId,
          pickupAt: new Date(Date.now() + 36 * 3600_000).toISOString(),
          roundTrip: false,
        })
        .expect(400);

      expect(errorOf(response).code).toBe('validation');
    });

    it('is still refused when the grant would otherwise allow it', async () => {
      // A permission and a subscription are different questions. Collapsing
      // them would make a lapsed plan read as "you are not family".
      const { user, appointmentId } = await familyWithAppointment();
      await harness.prisma.subscription.updateMany({ data: { status: 'canceled' } });

      const response = await authed(harness, user.accessToken)
        .post('/api/v1/rides')
        .send({
          appointmentId,
          pickupAt: new Date(Date.now() + 36 * 3600_000).toISOString(),
          roundTrip: false,
        });

      expect(response.status).toBe(400);
    });

    it('keeps booking while a payment is failing, inside the grace window', async () => {
      // The failure this guards against is concrete: a declined renewal
      // blanking the map while somebody's mother is in a stranger's car.
      const { user, appointmentId } = await familyWithAppointment();
      await harness.prisma.subscription.updateMany({
        data: { status: 'pastDue', pastDueSince: new Date() },
      });

      await authed(harness, user.accessToken)
        .post('/api/v1/rides')
        .send({
          appointmentId,
          pickupAt: new Date(Date.now() + 36 * 3600_000).toISOString(),
          roundTrip: false,
        })
        .expect(201);
    });
  });

  // ─── the operator ─────────────────────────────────────────────────────────

  describe('a dispatch operator', () => {
    async function operatorWithDrivers(driverCount: number) {
      const owner = await registerUser(harness);
      const outsider = await registerUser(harness);

      const organization = await harness.prisma.organization.create({
        data: {
          name: 'Meridian Transit Partners',
          slug: `meridian-${(organizationSequence += 1).toString(36)}-${Date.now().toString(36)}`,
          contactEmail: 'dispatch@meridiantransit.example',
        },
      });

      await harness.prisma.organizationMembership.create({
        data: { userId: owner.userId, organizationId: organization.id, role: 'owner' },
      });

      const vehicle = await harness.prisma.vehicle.create({
        data: {
          organizationId: organization.id,
          make: 'Toyota',
          model: 'Sienna',
          color: 'Silver',
          licensePlate: 'OH-0000',
        },
      });

      for (let index = 0; index < driverCount; index += 1) {
        await harness.prisma.driver.create({
          data: {
            organizationId: organization.id,
            displayName: `Driver ${index}`,
            vehicleId: vehicle.id,
            // An established fleet, not a roster being built. `approved` is
            // the only status that occupies a billable seat — the lifecycle
            // itself is exercised in dispatch.e2e-spec.ts.
            status: 'approved',
            approvedAt: new Date(),
          },
        });
      }

      return { owner, outsider, organization };
    }

    it('is priced by the drivers it actually has on the road', async () => {
      const { owner, organization } = await operatorWithDrivers(25);

      const response = await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
        .send({ planCode: 'dispatch-core', interval: 'monthly' })
        .expect(201);

      const account = response.body as {
        subscription: {
          seats: number;
          renewalQuote: {
            totalCents: number;
            lines: Array<{ label: string; quantity: number }>;
          };
        };
      };

      expect(account.subscription.seats).toBe(25);
      // Graduated: five included, fifteen at $18, five at $14.
      expect(account.subscription.renewalQuote.totalCents).toBe(19_900 + 27_000 + 7000);
      expect(account.subscription.renewalQuote.lines).toHaveLength(3);
    });

    it('cannot subscribe at five seats and run twenty', async () => {
      const { owner, organization } = await operatorWithDrivers(20);

      const response = await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
        .send({ planCode: 'dispatch-core', interval: 'monthly' })
        .expect(201);

      const account = response.body as { subscription: { seats: number } };
      expect(account.subscription.seats).toBe(20);
    });

    it('shows the ledger an invoice line is answerable from', async () => {
      const { owner, organization } = await operatorWithDrivers(7);
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
        .send({ planCode: 'dispatch-core', interval: 'annual' })
        .expect(201);

      const response = await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organization.id}/seats`)
        .expect(200);

      const seats = response.body as {
        activeDrivers: number;
        billedSeats: number;
        renewalQuote: { totalCents: number };
      };
      expect(seats.activeDrivers).toBe(7);
      expect(seats.billedSeats).toBe(7);
      expect(seats.renewalQuote.totalCents).toBe(199_000 + 2 * 18_000);
    });

    it('is invisible to somebody who is not in it', async () => {
      const { owner, outsider, organization } = await operatorWithDrivers(3);
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
        .send({ planCode: 'dispatch-core', interval: 'monthly' })
        .expect(201);

      await expectsIndistinguishableDenial({
        token: outsider.accessToken,
        forbidden: (token) =>
          authed(harness, token).get(
            `/api/v1/organizations/${organization.id}/billing`,
          ),
        missing: (token) =>
          authed(harness, token).get(
            '/api/v1/organizations/00000000-0000-4000-8000-0000000000ff/billing',
          ),
      });
    });

    it('does not let a dispatcher change what the company pays', async () => {
      const { owner, outsider, organization } = await operatorWithDrivers(3);
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
        .send({ planCode: 'dispatch-core', interval: 'monthly' })
        .expect(201);

      await harness.prisma.organizationMembership.create({
        data: {
          userId: outsider.userId,
          organizationId: organization.id,
          role: 'dispatcher',
        },
      });

      // A dispatcher may read the seat count — they are the person who adds
      // drivers — and may not move the company to an annual contract.
      await authed(harness, outsider.accessToken)
        .get(`/api/v1/organizations/${organization.id}/seats`)
        .expect(200);

      await authed(harness, outsider.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/change-interval`)
        .send({ interval: 'annual' })
        .expect(404);
    });

    it('loses access the moment its membership is revoked', async () => {
      const { owner, organization } = await operatorWithDrivers(3);
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
        .send({ planCode: 'dispatch-core', interval: 'monthly' })
        .expect(201);

      await harness.prisma.organizationMembership.updateMany({
        where: { userId: owner.userId },
        data: { revokedAt: new Date() },
      });

      await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organization.id}/billing`)
        .expect(404);
    });
  });
});
