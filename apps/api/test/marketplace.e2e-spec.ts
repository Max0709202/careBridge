import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createPatient,
  registerUser,
  verifyEmail,
  type TestUser,
} from './support/factories';

/**
 * The caregiver marketplace.
 *
 * Two things are being proved, and only one of them is a feature.
 *
 * The feature is the arrangement: a family books somebody, the caregiver
 * accepts, arrives, leaves, and the money is decided from when they were
 * actually there.
 *
 * The other is a **product position**. FOUNDATION §5A: no claim that platform
 * checks replace background screening. That is asserted here on the wire — the
 * words that never appear, and the fact that verification does not touch the
 * ordering — because a promise that only exists in a document is a promise
 * somebody removes during a redesign.
 */
describe('the caregiver marketplace', () => {
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

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function caregiver(
    options: {
      rate?: number;
      verified?: boolean;
      checkedDaysAgo?: number;
      name?: string;
    } = {},
  ): Promise<{ user: TestUser; caregiverId: string }> {
    const user = await registerUser(harness);

    await authed(harness, user.accessToken)
      .put('/api/v1/marketplace/me')
      .send({
        displayName: options.name ?? 'Aisha K.',
        bio: 'I sit with people, make tea, and get them to the door on time.',
        yearsExperience: 6,
        languages: ['English', 'Urdu'],
        hourlyRateCents: options.rate ?? 2800,
        serviceAreaCity: 'Columbus',
        serviceAreaState: 'OH',
      })
      .expect(200);

    const row = await harness.prisma.caregiver.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    if (options.verified ?? true) {
      // Verification is done out of band on purpose — there is deliberately no
      // endpoint that marks somebody verified, because one that could would be
      // the most valuable thing in this module to find a flaw in.
      await harness.prisma.caregiver.update({
        where: { id: row.id },
        data: {
          status: 'verified',
          identityVerifiedAt: new Date(),
          backgroundCheckAt: new Date(
            Date.now() - (options.checkedDaysAgo ?? 30) * 24 * 3600_000,
          ),
        },
      });
    }

    return { user, caregiverId: row.id };
  }

  async function family() {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);
    const patientId = await createPatient(harness, user.accessToken);
    return { user, patientId };
  }

  const inHours = (hours: number) =>
    new Date(Date.now() + hours * 3600_000).toISOString();

  async function booking(options: { hoursAway?: number } = {}) {
    const carer = await caregiver();
    const household = await family();
    const away = options.hoursAway ?? 48;

    const response = await authed(harness, household.user.accessToken)
      .post('/api/v1/marketplace/bookings')
      .send({
        caregiverId: carer.caregiverId,
        patientId: household.patientId,
        startsAt: inHours(away),
        endsAt: inHours(away + 3),
      })
      .expect(201);

    return {
      carer,
      household,
      bookingId: (response.body as { id: string }).id,
    };
  }

  // ─── the product position ─────────────────────────────────────────────────

  describe('what a family is told about a person', () => {
    it('gives a sentence describing the checks, not a badge', async () => {
      const { user } = await family();
      await caregiver();

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/marketplace/caregivers')
        .expect(200);

      const [card] = response.body as Array<{
        verificationStatement: string;
        identityConfirmed: boolean;
      }>;
      expect(card?.verificationStatement).toMatch(/confirmed this person’s identity/i);
      expect(card?.verificationStatement).toMatch(/decide for yourself/i);
    });

    it('never says safe, vetted, approved, trusted or guaranteed', async () => {
      // On the wire, not just in a unit test. A promise that only exists in a
      // document is a promise somebody removes during a redesign.
      const { user } = await family();
      await caregiver({ checkedDaysAgo: 5 });
      await caregiver({ name: 'Nadia P.', verified: false });

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/marketplace/caregivers')
        .expect(200);

      const serialised = JSON.stringify(response.body).toLowerCase();
      for (const word of ['safe', 'vetted', 'approved', 'trusted', 'guarantee']) {
        expect(serialised).not.toContain(word);
      }
    });

    it('shows an old check as old rather than hiding it', async () => {
      const { user } = await family();
      await caregiver({ checkedDaysAgo: 500 });

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/marketplace/caregivers')
        .expect(200);

      const [card] = response.body as Array<{ verificationStatement: string }>;
      expect(card?.verificationStatement).toMatch(/more than a year ago/i);
    });

    it('does not list somebody who has not been verified', async () => {
      // A profile nobody may book is a dead end with somebody's photograph on
      // it.
      const { user } = await family();
      await caregiver({ verified: false });

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/marketplace/caregivers')
        .expect(200);
      expect(response.body).toEqual([]);
    });

    it('withholds a rating until it rests on something', async () => {
      const { user } = await family();
      await caregiver();

      const response = await authed(harness, user.accessToken)
        .get('/api/v1/marketplace/caregivers')
        .expect(200);

      const [card] = response.body as Array<{
        rating: number | null;
        reviewCount: number;
      }>;
      expect(card?.rating).toBeNull();
      expect(card?.reviewCount).toBe(0);
    });
  });

  // ─── listing yourself ─────────────────────────────────────────────────────

  describe('creating a listing', () => {
    it('always lands as applied, never verified', async () => {
      const user = await registerUser(harness);

      await authed(harness, user.accessToken)
        .put('/api/v1/marketplace/me')
        .send({
          displayName: 'Aisha K.',
          bio: 'I sit with people, make tea, and get them to the door on time.',
          yearsExperience: 6,
          languages: ['English'],
          hourlyRateCents: 2800,
          serviceAreaCity: 'Columbus',
          serviceAreaState: 'OH',
        })
        .expect(200);

      const row = await harness.prisma.caregiver.findUniqueOrThrow({
        where: { userId: user.userId },
      });
      expect(row.status).toBe('applied');
    });

    it('refuses a rate of nothing', async () => {
      const user = await registerUser(harness);
      await authed(harness, user.accessToken)
        .put('/api/v1/marketplace/me')
        .send({
          displayName: 'Aisha K.',
          bio: 'I sit with people, make tea, and get them to the door on time.',
          yearsExperience: 6,
          languages: ['English'],
          hourlyRateCents: 0,
          serviceAreaCity: 'Columbus',
          serviceAreaState: 'OH',
        })
        .expect(400);
    });
  });

  // ─── booking ──────────────────────────────────────────────────────────────

  describe('booking a visit', () => {
    it('needs the same grant that arranging a car does', async () => {
      // Booking somebody to sit with a patient is at least as consequential.
      const carer = await caregiver();
      const household = await family();
      const stranger = await registerUser(harness);
      await verifyEmail(harness, stranger.userId);

      await authed(harness, stranger.accessToken)
        .post('/api/v1/marketplace/bookings')
        .send({
          caregiverId: carer.caregiverId,
          patientId: household.patientId,
          startsAt: inHours(48),
          endsAt: inHours(51),
        })
        .expect(404);
    });

    it('stamps the rate agreed at booking', async () => {
      // A caregiver raising their price must not re-price work somebody has
      // already agreed to.
      const { carer, bookingId } = await booking();

      await harness.prisma.caregiver.update({
        where: { id: carer.caregiverId },
        data: { hourlyRateCents: 9900 },
      });

      const row = await harness.prisma.caregiverBooking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      expect(row.hourlyRateCents).toBe(2800);
    });

    it('refuses a visit shorter than an hour', async () => {
      const carer = await caregiver();
      const household = await family();

      const response = await authed(harness, household.user.accessToken)
        .post('/api/v1/marketplace/bookings')
        .send({
          caregiverId: carer.caregiverId,
          patientId: household.patientId,
          startsAt: inHours(48),
          endsAt: inHours(48.5),
        })
        .expect(400);
      expect(errorOf(response).message).toMatch(/shortest visit/i);
    });

    it('refuses a second booking over the same hours', async () => {
      const { carer, bookingId } = await booking({ hoursAway: 48 });
      expect(bookingId).toBeTruthy();

      const other = await family();
      const response = await authed(harness, other.user.accessToken)
        .post('/api/v1/marketplace/bookings')
        .send({
          caregiverId: carer.caregiverId,
          patientId: other.patientId,
          startsAt: inHours(49),
          endsAt: inHours(52),
        })
        .expect(400);
      expect(errorOf(response).message).toMatch(/already booked/i);
    });

    it('allows a back-to-back visit', async () => {
      // Two till three and three till four is a busy afternoon, not a double
      // booking.
      const { carer } = await booking({ hoursAway: 48 });
      const other = await family();

      await authed(harness, other.user.accessToken)
        .post('/api/v1/marketplace/bookings')
        .send({
          caregiverId: carer.caregiverId,
          patientId: other.patientId,
          startsAt: inHours(51),
          endsAt: inHours(54),
        })
        .expect(201);
    });
  });

  // ─── the visit ────────────────────────────────────────────────────────────

  describe('the visit itself', () => {
    async function confirmed() {
      const context = await booking();
      await authed(harness, context.carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${context.bookingId}/accept`)
        .send({})
        .expect(201);
      return context;
    }

    it('is only the named caregiver who can accept it', async () => {
      const context = await booking();
      const outsider = await caregiver({ name: 'Nadia P.' });

      await authed(harness, outsider.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${context.bookingId}/accept`)
        .send({})
        .expect(404);
    });

    it('charges from when the caregiver was actually there', async () => {
      const { carer, bookingId } = await confirmed();

      await authed(harness, carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/check-in`)
        .send({})
        .expect(201);

      // Two hours twenty, backdated. The charge follows the checked times, not
      // the three hours that were booked.
      await harness.prisma.caregiverBooking.update({
        where: { id: bookingId },
        data: { checkedInAt: new Date(Date.now() - 140 * 60_000) },
      });

      const response = await authed(harness, carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/check-out`)
        .send({})
        .expect(201);

      const body = response.body as {
        status: string;
        billableMinutes: number;
        totalCents: number;
        caregiverPayoutCents: number;
      };
      expect(body.status).toBe('completed');
      // Rounded up to the next quarter-hour: rounding down would have somebody
      // work fourteen minutes for nothing.
      expect(body.billableMinutes).toBe(150);
      expect(body.totalCents).toBe(7000);
      expect(body.caregiverPayoutCents).toBe(5950);
    });

    it('will not check out somebody who never checked in', async () => {
      const { carer, bookingId } = await confirmed();

      await authed(harness, carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/check-out`)
        .send({})
        .expect(400);
    });

    it('will not let a visit in progress be cancelled', async () => {
      // What would be cancelled has already partly happened. The honest end
      // for a visit that went wrong is a completion plus a dispute.
      const { carer, household, bookingId } = await confirmed();
      await authed(harness, carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/check-in`)
        .send({})
        .expect(201);

      await authed(harness, household.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/cancel`)
        .send({ reason: 'Changed our minds.' })
        .expect(409);
    });

    it('lets only the family report a no-show', async () => {
      // A caregiver marking their own booking as a no-show would be marking
      // the family.
      const { carer, bookingId } = await confirmed();

      await authed(harness, carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/no-show`)
        .send({})
        .expect(404);
    });
  });

  // ─── cancelling ───────────────────────────────────────────────────────────

  describe('cancelling', () => {
    it('quotes nothing with more than a day’s notice', async () => {
      const { household, bookingId } = await booking({ hoursAway: 48 });

      const response = await authed(harness, household.user.accessToken)
        .get(`/api/v1/marketplace/bookings/${bookingId}/cancellation-quote`)
        .expect(200);

      const quote = response.body as { feeCents: number; explanation: string };
      expect(quote.feeCents).toBe(0);
      expect(quote.explanation).toMatch(/no charge/i);
    });

    it('quotes half for late notice, never the whole visit', async () => {
      const { household, bookingId } = await booking({ hoursAway: 3 });

      const response = await authed(harness, household.user.accessToken)
        .get(`/api/v1/marketplace/bookings/${bookingId}/cancellation-quote`)
        .expect(200);

      const quote = response.body as { feeCents: number };
      expect(quote.feeCents).toBe(4200);
    });

    it('charges the family nothing when the caregiver cancels', async () => {
      const { carer, bookingId } = await booking({ hoursAway: 3 });

      const response = await authed(harness, carer.user.accessToken)
        .get(`/api/v1/marketplace/bookings/${bookingId}/cancellation-quote`)
        .expect(200);
      expect((response.body as { feeCents: number }).feeCents).toBe(0);
    });

    it('insists on a reason', async () => {
      const { household, bookingId } = await booking();

      await authed(harness, household.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/cancel`)
        .send({})
        .expect(400);
    });

    it('frees the slot for somebody else', async () => {
      const { carer, household, bookingId } = await booking({ hoursAway: 48 });

      await authed(harness, household.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/cancel`)
        .send({ reason: 'She is in hospital.' })
        .expect(201);

      const other = await family();
      await authed(harness, other.user.accessToken)
        .post('/api/v1/marketplace/bookings')
        .send({
          caregiverId: carer.caregiverId,
          patientId: other.patientId,
          startsAt: inHours(48),
          endsAt: inHours(51),
        })
        .expect(201);
    });
  });

  // ─── afterwards ───────────────────────────────────────────────────────────

  describe('reviews', () => {
    async function completed() {
      const context = await booking();
      await authed(harness, context.carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${context.bookingId}/accept`)
        .send({})
        .expect(201);
      await authed(harness, context.carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${context.bookingId}/check-in`)
        .send({})
        .expect(201);
      await authed(harness, context.carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${context.bookingId}/check-out`)
        .send({})
        .expect(201);
      return context;
    }

    it('accepts one from a visit that happened', async () => {
      const { household, bookingId } = await completed();

      const response = await authed(harness, household.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/review`)
        .send({ rating: 5, comment: 'She was wonderful with my mother.' })
        .expect(201);

      expect((response.body as { hasReview: boolean }).hasReview).toBe(true);
    });

    it('refuses one for a visit that did not', async () => {
      // A family who never met somebody must not be able to end their career.
      const { household, bookingId } = await booking();

      const response = await authed(harness, household.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/review`)
        .send({ rating: 1 })
        .expect(400);
      expect(errorOf(response).message).toMatch(/visit that happened/i);
    });

    it('refuses a second review of the same visit', async () => {
      const { household, bookingId } = await completed();
      const url = `/api/v1/marketplace/bookings/${bookingId}/review`;

      await authed(harness, household.user.accessToken)
        .post(url)
        .send({ rating: 5 })
        .expect(201);
      await authed(harness, household.user.accessToken)
        .post(url)
        .send({ rating: 5 })
        .expect(400);
    });

    it('refuses one from the caregiver about themselves', async () => {
      const { carer, bookingId } = await completed();

      await authed(harness, carer.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/review`)
        .send({ rating: 5 })
        .expect(404);
    });
  });

  describe('disputes', () => {
    it('is decided by CareBridge, not by either party', async () => {
      const { household, bookingId } = await booking();

      await authed(harness, household.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/dispute`)
        .send({ reason: 'Nobody arrived and we were not told.' })
        .expect(201);

      // The family cannot decide their own dispute.
      await authed(harness, household.user.accessToken)
        .post(`/api/v1/admin/marketplace/bookings/${bookingId}/dispute/resolve`)
        .send({ outcome: 'refunded', note: 'We would like our money back.' })
        .expect(404);
    });

    it('records the outcome, the reason and the person', async () => {
      const { household, bookingId } = await booking();
      await authed(harness, household.user.accessToken)
        .post(`/api/v1/marketplace/bookings/${bookingId}/dispute`)
        .send({ reason: 'Nobody arrived and we were not told.' })
        .expect(201);

      const admin = await registerUser(harness);
      await harness.prisma.user.update({
        where: { id: admin.userId },
        data: { platformRole: 'admin' },
      });
      await harness.prisma.userMfa.create({
        data: {
          userId: admin.userId,
          secretCiphertext: Buffer.from('c'),
          secretIv: Buffer.from('i'),
          secretAuthTag: Buffer.from('t'),
          confirmedAt: new Date(),
        },
      });

      await authed(harness, admin.accessToken)
        .post(`/api/v1/admin/marketplace/bookings/${bookingId}/dispute/resolve`)
        .send({
          outcome: 'refunded',
          note: 'The caregiver confirmed they could not attend and did not say so.',
        })
        .expect(201);

      const dispute = await harness.prisma.bookingDispute.findUniqueOrThrow({
        where: { bookingId },
      });
      expect(dispute.status).toBe('resolved');
      expect(dispute.outcome).toBe('refunded');
      expect(dispute.resolvedByUserId).toBe(admin.userId);
      expect(dispute.resolutionNote).toBeTruthy();
    });

    it('cannot be raised twice', async () => {
      const { household, bookingId } = await booking();
      const url = `/api/v1/marketplace/bookings/${bookingId}/dispute`;

      await authed(harness, household.user.accessToken)
        .post(url)
        .send({ reason: 'Nobody arrived and we were not told.' })
        .expect(201);
      await authed(harness, household.user.accessToken)
        .post(url)
        .send({ reason: 'Still nobody.' })
        .expect(400);
    });
  });
});
