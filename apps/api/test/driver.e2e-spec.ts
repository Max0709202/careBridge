import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  registerUser,
  uniqueEmail,
  verifyEmail,
  type TestUser,
} from './support/factories';
import {
  expectsAuthentication,
  expectsIndistinguishableDenial,
} from './support/negative-paths';
import { NO_SHOW_WAIT_MS } from '../src/domain/driver-authority';

/**
 * The driver's side of a ride.
 *
 * Two things here carry more weight than the rest, and both are about what a
 * driver's phone must *not* become.
 *
 * The first is the claim. A driver is put on a roster before they have an
 * account, so something has to join the two later — and whatever that
 * something is, it decides who receives a stream of elderly people's home
 * addresses and telephone numbers. It matches on a **verified** address for
 * that reason and nothing else.
 *
 * The second is the shape of the work list. A finished ride leaves it. The
 * operator keeps the record; the phone does not.
 */
let organizationSequence = 0;
let plateSequence = 0;

/** The single row a driver's work list is expected to hold. */
function only<T>(rows: T[]): T {
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error('expected exactly one row');
  return row;
}

describe('the driver app', () => {
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

  async function operator() {
    const owner = await registerUser(harness);

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

    await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
      .send({ planCode: 'dispatch-core', interval: 'monthly' })
      .expect(201);

    return { owner, organizationId: organization.id };
  }

  async function addVehicle(token: string, organizationId: string): Promise<string> {
    const response = await authed(harness, token)
      .post(`/api/v1/organizations/${organizationId}/vehicles`)
      .send({
        make: 'Toyota',
        model: 'Sienna',
        color: 'Silver',
        licensePlate: `OH-${(plateSequence += 1).toString().padStart(4, '0')}`,
        isWheelchairAccessible: true,
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /**
   * A driver on a roster, with an account waiting to claim it.
   *
   * `approve` defaults true because most of what is tested here needs a driver
   * who can work; the tests about approval say so explicitly.
   */
  async function rosteredDriver(
    options: {
      approve?: boolean;
      verify?: boolean;
      email?: string;
      onShift?: boolean;
    } = {},
  ) {
    const { owner, organizationId } = await operator();
    const vehicleId = await addVehicle(owner.accessToken, organizationId);

    const email = options.email ?? uniqueEmail('driver');
    const account = await registerUser(harness, { email });
    if (options.verify ?? true) await verifyEmail(harness, account.userId);

    const created = await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organizationId}/drivers`)
      .send({ displayName: 'Marcus T.', vehicleId, email })
      .expect(201);
    const driverId = (created.body as { id: string }).id;

    if (options.approve ?? true) {
      for (const to of ['pendingApproval', 'approved']) {
        await authed(harness, owner.accessToken)
          .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
          .send({ to })
          .expect(201);
      }
    }

    if (options.onShift ?? true) {
      await authed(harness, owner.accessToken)
        .put(`/api/v1/organizations/${organizationId}/drivers/${driverId}/shift`)
        .send({ onShift: true })
        .expect(200);
    }

    return { owner, organizationId, vehicleId, driverId, account, email };
  }

  /** A ride booked by a family and handed to this driver. */
  async function assignedRide(context: {
    owner: TestUser;
    organizationId: string;
    driverId: string;
  }): Promise<{ rideId: string; family: TestUser; patientId: string }> {
    const family = await registerUser(harness);
    await verifyEmail(harness, family.userId);

    const patientId = await createPatient(harness, family.accessToken, {
      preferredName: 'Margaret',
      phone: '+1-555-0147',
    });
    const clinicId = await createClinic(harness, family.accessToken);
    const appointmentId = await createAppointment(harness, family.accessToken, {
      patientId,
      clinicId,
    });

    await authed(harness, family.accessToken)
      .post('/api/v1/rides')
      .send({
        appointmentId,
        pickupAt: new Date(Date.now() + 36 * 3600_000).toISOString(),
        roundTrip: false,
      })
      .expect(201);

    const ride = await harness.prisma.ride.findFirstOrThrow({ where: { patientId } });

    await authed(harness, context.owner.accessToken)
      .post(
        `/api/v1/organizations/${context.organizationId}/dispatch/rides/${ride.id}/assign`,
      )
      .send({ driverId: context.driverId })
      .expect(201);

    return { rideId: ride.id, family, patientId };
  }

  /** Walks a ride forward through the driver's own sequence. */
  async function advance(token: string, rideId: string, to: string, expect = 201) {
    return authed(harness, token)
      .post(`/api/v1/driver/rides/${rideId}/advance`)
      .send({ to })
      .expect(expect);
  }

  /** Resumable: picks up from wherever the ride has already reached. */
  async function driveTo(token: string, rideId: string, target: string) {
    const sequence = [
      'driverAccepted',
      'driverEnRoute',
      'driverArrived',
      'passengerOnboard',
      'inProgress',
      'arrivedAtDestination',
      'completed',
    ];
    const ride = await harness.prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    for (const step of sequence.slice(sequence.indexOf(ride.status) + 1)) {
      await advance(token, rideId, step);
      if (step === target) return;
    }
  }

  // ─── claiming a roster place ──────────────────────────────────────────────

  describe('claiming a roster place', () => {
    it('joins the account to the driver the operator recorded', async () => {
      const { account, driverId, organizationId } = await rosteredDriver();

      const response = await authed(harness, account.accessToken)
        .get('/api/v1/driver/me')
        .expect(200);

      const profile = response.body as {
        driverId: string;
        organizationId: string;
        organizationName: string;
        canWork: boolean;
      };
      expect(profile.driverId).toBe(driverId);
      expect(profile.organizationId).toBe(organizationId);
      expect(profile.organizationName).toBe('Meridian Transit Partners');
      expect(profile.canWork).toBe(true);
    });

    it('refuses an address the account has not verified', async () => {
      // The whole security of the claim rests here. Without verification,
      // registering with a driver's email address is enough to inherit their
      // assignments — and with them a series of passengers' home addresses.
      const { account } = await rosteredDriver({ verify: false });

      await authed(harness, account.accessToken).get('/api/v1/driver/me').expect(404);
    });

    it('claims once and stays claimed', async () => {
      const { account, driverId } = await rosteredDriver();

      await authed(harness, account.accessToken).get('/api/v1/driver/me').expect(200);
      await authed(harness, account.accessToken).get('/api/v1/driver/me').expect(200);

      const driver = await harness.prisma.driver.findUniqueOrThrow({
        where: { id: driverId },
      });
      expect(driver.userId).toBe(account.userId);
      expect(driver.accountLinkedAt).not.toBeNull();
    });

    it('survives the same driver opening the app on two devices at once', async () => {
      // Both requests find the row unclaimed and race to take it. Exactly one
      // update lands; the loser re-reads and finds the place is already its
      // own. Refusing it would mean a driver whose second phone can never sign
      // in — and the guard exists to stop an overwrite, not to stop them.
      const { account, driverId } = await rosteredDriver();

      const results = await Promise.all([
        authed(harness, account.accessToken).get('/api/v1/driver/me'),
        authed(harness, account.accessToken).get('/api/v1/driver/me'),
      ]);

      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const claimed = await harness.prisma.driver.findUniqueOrThrow({
        where: { id: driverId },
      });
      expect(claimed.userId).toBe(account.userId);
    });

    it('refuses a place that has already been claimed', async () => {
      // The guard that matters. Even with the recorded address changed to
      // theirs afterwards, a second account cannot take a place somebody is
      // already driving — `userId: null` is in the where clause, not checked
      // after the fact.
      const { account, driverId } = await rosteredDriver();
      await authed(harness, account.accessToken).get('/api/v1/driver/me').expect(200);

      const second = await registerUser(harness);
      await verifyEmail(harness, second.userId);
      await harness.prisma.driver.update({
        where: { id: driverId },
        data: { invitedEmail: second.email },
      });

      await authed(harness, second.accessToken).get('/api/v1/driver/me').expect(404);

      const unchanged = await harness.prisma.driver.findUniqueOrThrow({
        where: { id: driverId },
      });
      expect(unchanged.userId).toBe(account.userId);
    });

    it('refuses an account with no roster place at all', async () => {
      const stranger = await registerUser(harness);
      await verifyEmail(harness, stranger.userId);

      await authed(harness, stranger.accessToken).get('/api/v1/driver/me').expect(404);
    });

    it('will not let an offboarded driver back in', async () => {
      // The row is kept so old rides still name somebody. It must not double
      // as a way back into the app.
      const { owner, organizationId, driverId, account } = await rosteredDriver();
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'offboarded' })
        .expect(201);

      await authed(harness, account.accessToken).get('/api/v1/driver/me').expect(404);
    });

    it('refuses an unauthenticated caller', async () => {
      await expectsAuthentication((token) =>
        authed(harness, token).get('/api/v1/driver/me'),
      );
    });
  });

  // ─── the shift ────────────────────────────────────────────────────────────

  describe('the shift', () => {
    it('will not start one before the operator has approved the driver', async () => {
      const { account } = await rosteredDriver({ approve: false, onShift: false });

      const response = await authed(harness, account.accessToken)
        .put('/api/v1/driver/shift')
        .send({ onShift: true })
        .expect(400);

      expect(errorOf(response).message).toMatch(/not approved you/i);
    });

    it('says so plainly when the driver has been suspended', async () => {
      // Being locked out of your own job with no reason given is how support
      // queues fill up.
      const { owner, organizationId, driverId, account } = await rosteredDriver({
        onShift: false,
      });
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'suspended', reason: 'Licence under review' })
        .expect(201);

      const response = await authed(harness, account.accessToken)
        .put('/api/v1/driver/shift')
        .send({ onShift: true })
        .expect(400);
      expect(errorOf(response).message).toMatch(/suspended/i);

      const profile = await authed(harness, account.accessToken)
        .get('/api/v1/driver/me')
        .expect(200);
      expect((profile.body as { suspensionReason: string }).suspensionReason).toBe(
        'Licence under review',
      );
    });

    it('starts and ends a shift', async () => {
      const { account } = await rosteredDriver({ onShift: false });

      const on = await authed(harness, account.accessToken)
        .put('/api/v1/driver/shift')
        .send({ onShift: true })
        .expect(200);
      expect((on.body as { onShift: boolean }).onShift).toBe(true);

      const off = await authed(harness, account.accessToken)
        .put('/api/v1/driver/shift')
        .send({ onShift: false })
        .expect(200);
      expect((off.body as { onShift: boolean }).onShift).toBe(false);
    });

    it('refuses to end a shift with somebody in the car', async () => {
      // Dispatch reads "on shift" to decide who can take the next job. A
      // driver who leaves that list mid-trip is a passenger nobody is
      // accountable for.
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'passengerOnboard');

      const response = await authed(harness, context.account.accessToken)
        .put('/api/v1/driver/shift')
        .send({ onShift: false })
        .expect(400);
      expect(errorOf(response).message).toMatch(/finish the ride/i);
    });
  });

  // ─── the work list ────────────────────────────────────────────────────────

  describe('the work list', () => {
    it('shows what the driver needs to collect somebody', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);

      const response = await authed(harness, context.account.accessToken)
        .get('/api/v1/driver/rides')
        .expect(200);

      const rides = response.body as Array<{
        id: string;
        passengerName: string;
        passengerPhone: string;
        pickup: { line1: string };
        availableTransitions: string[];
        shareLocation: boolean;
      }>;
      const ride = only(rides);
      expect(ride.id).toBe(rideId);
      expect(ride.passengerName).toBe('Margaret');
      expect(ride.passengerPhone).toBe('+1-555-0147');
      expect(ride.pickup.line1).toBe('400 Parkside Avenue');
      // Advisory only — the server asserts it again — but it is what decides
      // which button the app draws.
      expect(ride.availableTransitions).toEqual(['driverAccepted']);
      expect(ride.shareLocation).toBe(false);
    });

    it('drops a finished ride, and the passenger’s details with it', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'completed');

      const response = await authed(harness, context.account.accessToken)
        .get('/api/v1/driver/rides')
        .expect(200);
      expect(response.body).toEqual([]);
    });

    it('shows nothing belonging to another driver', async () => {
      const context = await rosteredDriver();
      await assignedRide(context);

      const other = await rosteredDriver();
      const response = await authed(harness, other.account.accessToken)
        .get('/api/v1/driver/rides')
        .expect(200);
      expect(response.body).toEqual([]);
    });

    it('says when location should be shared, and only then', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'driverEnRoute');

      const response = await authed(harness, context.account.accessToken)
        .get('/api/v1/driver/rides')
        .expect(200);
      const rides = response.body as Array<{ shareLocation: boolean }>;
      expect(only(rides).shareLocation).toBe(true);
    });
  });

  // ─── moving the ride ──────────────────────────────────────────────────────

  describe('moving the ride', () => {
    it('walks the whole trip', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);

      await driveTo(context.account.accessToken, rideId, 'completed');

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.status).toBe('completed');
    });

    it('records the driver by name in the ride’s history', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await advance(context.account.accessToken, rideId, 'driverAccepted');

      const history = await harness.prisma.rideStatusHistory.findFirstOrThrow({
        where: { rideId, toStatus: 'driverAccepted' },
      });
      expect(history.actor).toBe('Marcus T.');
    });

    it('refuses to cancel', async () => {
      // A ride the driver would rather not do is still owed. Telling the
      // family it was called off is a different and untrue statement.
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);

      await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/advance`)
        .send({ to: 'canceled' })
        .expect(400);
    });

    it('refuses to hand the ride back to dispatch', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);

      await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/advance`)
        .send({ to: 'reassignmentRequired' })
        .expect(400);
    });

    it('refuses a move out of sequence', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);

      await advance(context.account.accessToken, rideId, 'passengerOnboard', 409);
    });

    it('refuses to accept work while off shift', async () => {
      // Assigned while working, then stood down before they accepted — the
      // dispatcher heard about the flat tyre first. Accepting is the moment a
      // person becomes responsible for a passenger, and it must not happen
      // after they have gone home.
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);

      await authed(harness, context.owner.accessToken)
        .put(
          `/api/v1/organizations/${context.organizationId}/drivers/${context.driverId}/shift`,
        )
        .send({ onShift: false })
        .expect(200);

      const response = await advance(
        context.account.accessToken,
        rideId,
        'driverAccepted',
        400,
      );
      expect(errorOf(response).message).toMatch(/start your shift/i);
    });

    it('lets a driver suspended mid-trip still finish it', async () => {
      // Suspension stops the next job. It must not strand a passenger who is
      // already in the car behind a screen that never changes.
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'inProgress');

      await authed(harness, context.owner.accessToken)
        .post(
          `/api/v1/organizations/${context.organizationId}/drivers/${context.driverId}/status`,
        )
        .send({ to: 'suspended', reason: 'Incident reported' })
        .expect(201);

      await advance(context.account.accessToken, rideId, 'arrivedAtDestination');
      await advance(context.account.accessToken, rideId, 'completed');

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.status).toBe('completed');
    });

    it('answers another driver’s ride exactly as a ride that does not exist', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      const other = await rosteredDriver();

      await expectsIndistinguishableDenial({
        token: other.account.accessToken,
        forbidden: (token) =>
          authed(harness, token)
            .post(`/api/v1/driver/rides/${rideId}/advance`)
            .send({ to: 'driverAccepted' }),
        missing: (token) =>
          authed(harness, token)
            .post('/api/v1/driver/rides/11111111-2222-3333-4444-555555555555/advance')
            .send({ to: 'driverAccepted' }),
      });
    });
  });

  // ─── the wait at the kerb ─────────────────────────────────────────────────

  describe('declaring a no-show', () => {
    it('will not accept one the moment the car pulls up', async () => {
      // Declared thirty seconds after arriving, a no-show means the driver did
      // not wait — and after the fact the two are indistinguishable unless the
      // clock is part of the rule.
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'driverArrived');

      const response = await advance(
        context.account.accessToken,
        rideId,
        'noShow',
        400,
      );
      expect(errorOf(response).message).toMatch(/wait a little longer/i);
    });

    it('counts down towards it on the work list', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'driverArrived');

      const response = await authed(harness, context.account.accessToken)
        .get('/api/v1/driver/rides')
        .expect(200);
      const remaining = only(
        response.body as Array<{ noShowAvailableInSeconds: number | null }>,
      ).noShowAvailableInSeconds;
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(NO_SHOW_WAIT_MS / 1000);
    });

    it('accepts one once the wait has been served', async () => {
      const context = await rosteredDriver();
      const { rideId } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'driverArrived');

      // Backdating the arrival rather than sleeping five minutes. The rule is
      // read from the ride's own history, so moving that row is the same thing
      // as waiting.
      await harness.prisma.rideStatusHistory.updateMany({
        where: { rideId, toStatus: 'driverArrived' },
        data: { at: new Date(Date.now() - NO_SHOW_WAIT_MS - 1_000) },
      });

      await advance(context.account.accessToken, rideId, 'noShow');
      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.status).toBe('noShow');
    });

    it('offers no countdown when a no-show is not on the table', async () => {
      const context = await rosteredDriver();
      await assignedRide(context);

      const response = await authed(harness, context.account.accessToken)
        .get('/api/v1/driver/rides')
        .expect(200);
      const rides = response.body as Array<{ noShowAvailableInSeconds: number | null }>;
      expect(only(rides).noShowAvailableInSeconds).toBeNull();
    });
  });

  // ─── flushing the offline queue ───────────────────────────────────────────

  describe('flushing the offline queue', () => {
    function point(secondsAgo: number, overrides: Record<string, unknown> = {}) {
      return {
        latitude: 40.651 + secondsAgo * 0.0001,
        longitude: -73.958,
        accuracyMeters: 9,
        capturedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
        ...overrides,
      };
    }

    async function drivingRide() {
      const context = await rosteredDriver();
      const { rideId, family } = await assignedRide(context);
      await driveTo(context.account.accessToken, rideId, 'driverEnRoute');
      return { context, rideId, family };
    }

    it('writes a whole batch and moves the map to the newest reading', async () => {
      const { context, rideId } = await drivingRide();

      const response = await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [point(30), point(20), point(10, { etaMinutes: 6 })] })
        .expect(201);

      expect(response.body).toMatchObject({
        stored: 3,
        ignored: 0,
        positionUpdated: true,
      });

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.etaMinutes).toBe(6);
      expect(await harness.prisma.rideLocationSample.count({ where: { rideId } })).toBe(
        3,
      );
    });

    it('sorts the batch rather than trusting the order it arrived in', async () => {
      const { context, rideId } = await drivingRide();

      await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [point(10, { etaMinutes: 4 }), point(40), point(25)] })
        .expect(201);

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      // The ten-second-old reading is the newest, whatever position it held in
      // the array a phone happened to send.
      expect(ride.etaMinutes).toBe(4);
    });

    it('is free to send twice', async () => {
      // The case this exists for: the batch was written, the response was lost,
      // and the app flushes the same queue again on the next connection.
      const { context, rideId } = await drivingRide();
      const points = [point(30), point(20)];

      await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points })
        .expect(201);

      const retry = await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points })
        .expect(201);

      expect(retry.body).toMatchObject({ stored: 0, ignored: 2 });
      expect(await harness.prisma.rideLocationSample.count({ where: { rideId } })).toBe(
        2,
      );
    });

    it('keeps a late batch as history without moving the map backwards', async () => {
      // A queue that drains after a tunnel legitimately holds readings from
      // four minutes ago. They belong in the journey record. They must not
      // overwrite a fresher position the family is already looking at.
      const { context, rideId } = await drivingRide();

      await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [point(5, { etaMinutes: 3 })] })
        .expect(201);

      const late = await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [point(240, { etaMinutes: 99 })] })
        .expect(201);

      expect(late.body).toMatchObject({ stored: 1, positionUpdated: false });
      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.etaMinutes).toBe(3);
    });

    it('refuses a reading stamped in the future', async () => {
      // It would age as permanently fresh — a stopped car rendered as a moving
      // one, which is the single failure mode this product cannot have.
      const { context, rideId } = await drivingRide();

      const response = await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [point(-600)] })
        .expect(201);

      expect(response.body).toMatchObject({ stored: 0, ignored: 1 });
    });

    it('refuses the whole batch once the ride is over', async () => {
      // Not filtered — refused. Location stops being collectable the moment
      // the ride ends, and a queue that drains afterwards is carrying readings
      // that should never be stored.
      const { context, rideId } = await drivingRide();
      await driveTo(context.account.accessToken, rideId, 'completed');

      const response = await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [point(5)] })
        .expect(400);

      expect(errorOf(response).message).toMatch(/not in a state/i);
      expect(await harness.prisma.rideLocationSample.count({ where: { rideId } })).toBe(
        0,
      );
    });

    it('refuses a batch for somebody else’s ride', async () => {
      const { rideId } = await drivingRide();
      const other = await rosteredDriver();

      await authed(harness, other.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [point(5)] })
        .expect(404);
    });

    it('refuses an empty batch and an oversized one', async () => {
      const { context, rideId } = await drivingRide();

      await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: [] })
        .expect(400);

      await authed(harness, context.account.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({ points: Array.from({ length: 241 }, (_, i) => point(i + 1)) })
        .expect(400);
    });
  });
});
