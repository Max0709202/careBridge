import { TestHarness } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  giveDriverPaperwork,
  registerUser,
  uniqueEmail,
  verifyEmail,
  type TestUser,
} from './support/factories';
import { MAPS, type MapsPort } from '../src/infrastructure/maps/maps.port';

/**
 * "The driver is six minutes away", end to end.
 *
 * The number the whole product is built around, arriving the way it will in
 * production: a driver's app reports a position, the server routes it, and the
 * family's snapshot carries the answer. Three things are asserted that a unit
 * test cannot reach — that the number appears at all through the real
 * endpoints, that a burst of position reports does not become a burst of
 * billable lookups, and that **a client cannot set it**.
 */
let organizationSequence = 0;
let plateSequence = 0;

describe('the arrival estimate', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
    jest.restoreAllMocks();
  });

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function drivingRide(): Promise<{
    family: TestUser;
    driver: TestUser;
    owner: TestUser;
    organizationId: string;
    driverId: string;
    rideId: string;
  }> {
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

    const vehicle = await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/vehicles`)
      .send({
        make: 'Toyota',
        model: 'Sienna',
        color: 'Silver',
        licensePlate: `OH-${(plateSequence += 1).toString().padStart(4, '0')}`,
        isWheelchairAccessible: true,
      })
      .expect(201);

    const email = uniqueEmail('driver');
    const driver = await registerUser(harness, { email });
    await verifyEmail(harness, driver.userId);

    const created = await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/drivers`)
      .send({
        displayName: 'Marcus T.',
        vehicleId: (vehicle.body as { id: string }).id,
        email,
      })
      .expect(201);
    const driverId = (created.body as { id: string }).id;

    await giveDriverPaperwork(harness, driverId, owner.userId);
    for (const to of ['pendingApproval', 'approved']) {
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/drivers/${driverId}/status`)
        .send({ to })
        .expect(201);
    }
    await authed(harness, owner.accessToken)
      .put(`/api/v1/organizations/${organization.id}/drivers/${driverId}/shift`)
      .send({ onShift: true })
      .expect(200);

    const family = await registerUser(harness);
    await verifyEmail(harness, family.userId);
    const patientId = await createPatient(harness, family.accessToken);
    const clinicId = await createClinic(harness, family.accessToken);
    const appointmentId = await createAppointment(harness, family.accessToken, {
      patientId,
      clinicId,
    });

    await authed(harness, family.accessToken)
      .post('/api/v1/rides')
      .send({
        appointmentId,
        pickupAt: new Date(Date.now() + 3_600_000).toISOString(),
        roundTrip: false,
      })
      .expect(201);

    const ride = await harness.prisma.ride.findFirstOrThrow({ where: { patientId } });

    await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/dispatch/rides/${ride.id}/assign`)
      .send({ driverId })
      .expect(201);

    for (const to of ['driverAccepted', 'driverEnRoute']) {
      await authed(harness, driver.accessToken)
        .post(`/api/v1/driver/rides/${ride.id}/advance`)
        .send({ to })
        .expect(201);
    }

    return {
      family,
      driver,
      owner,
      organizationId: organization.id,
      driverId,
      rideId: ride.id,
    };
  }

  /** One position report, through the endpoint a driver's phone uses. */
  function report(
    token: string,
    rideId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return authed(harness, token)
      .post(`/api/v1/driver/rides/${rideId}/locations`)
      .send({
        points: [
          {
            latitude: 40.651,
            longitude: -73.958,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
            ...overrides,
          },
        ],
      });
  }

  async function etaOf(rideId: string): Promise<number | null> {
    const ride = await harness.prisma.ride.findUniqueOrThrow({
      where: { id: rideId },
    });
    return ride.etaMinutes;
  }

  function spyOnRouting() {
    const maps = harness.app.get<MapsPort>(MAPS);
    return jest.spyOn(maps, 'route');
  }

  // ─── the number appears ───────────────────────────────────────────────────

  describe('through the real path', () => {
    it('puts an estimate on the ride the first time a driver reports', async () => {
      const { driver, rideId } = await drivingRide();

      expect(await etaOf(rideId)).toBeNull();
      await report(driver.accessToken, rideId).expect(201);

      const eta = await etaOf(rideId);
      expect(eta).not.toBeNull();
      expect(eta!).toBeGreaterThan(0);
    });

    it('reaches the family’s own snapshot', async () => {
      // The point of the whole slice: a worried adult child opens the app and
      // sees a number that came from a routing vendor rather than from a
      // scripted preview trip.
      const { driver, family, rideId } = await drivingRide();
      await report(driver.accessToken, rideId).expect(201);

      const state = await authed(harness, family.accessToken)
        .get('/api/v1/care/state')
        .expect(200);

      const rides = (
        state.body as { rides: Array<{ id: string; etaMinutes: number | null }> }
      ).rides;
      const ride = rides.find((r) => r.id === rideId);
      expect(ride?.etaMinutes).toBeGreaterThan(0);
    });

    it('switches to the clinic once the passenger is in the car', async () => {
      const { driver, rideId } = await drivingRide();
      const routing = spyOnRouting();

      await report(driver.accessToken, rideId).expect(201);
      const toPickup = routing.mock.calls.length;

      for (const to of ['driverArrived', 'passengerOnboard']) {
        await authed(harness, driver.accessToken)
          .post(`/api/v1/driver/rides/${rideId}/advance`)
          .send({ to })
          .expect(201);
      }
      await report(driver.accessToken, rideId).expect(201);

      // A new route, because the cached one was a countdown to the house.
      expect(routing.mock.calls.length).toBeGreaterThan(toPickup);
      expect(await etaOf(rideId)).toBeGreaterThan(0);
    });

    it('says nothing while the car is standing at the kerb', async () => {
      // "Arriving in 1 minute" beside a driver at the door is the number that
      // makes somebody keep waiting inside.
      const { driver, rideId } = await drivingRide();
      await report(driver.accessToken, rideId).expect(201);
      expect(await etaOf(rideId)).not.toBeNull();

      await authed(harness, driver.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/advance`)
        .send({ to: 'driverArrived' })
        .expect(201);
      await report(driver.accessToken, rideId).expect(201);

      expect(await etaOf(rideId)).toBeNull();
    });

    it('clears when the ride ends', async () => {
      const { driver, rideId } = await drivingRide();
      await report(driver.accessToken, rideId).expect(201);

      for (const to of [
        'driverArrived',
        'passengerOnboard',
        'inProgress',
        'arrivedAtDestination',
        'completed',
      ]) {
        await authed(harness, driver.accessToken)
          .post(`/api/v1/driver/rides/${rideId}/advance`)
          .send({ to })
          .expect(201);
      }

      expect(await etaOf(rideId)).toBeNull();
    });
  });

  // ─── the client cannot set it ─────────────────────────────────────────────

  describe('who decides the number', () => {
    it('ignores an estimate the device tries to supply', async () => {
      // An ETA is a promise made to somebody waiting by a window. A field the
      // reporting device could set would let anything holding a driver's token
      // hold a family at "two minutes" indefinitely.
      const { driver, rideId } = await drivingRide();

      await report(driver.accessToken, rideId, { etaMinutes: 2 }).expect(201);

      const eta = await etaOf(rideId);
      expect(eta).not.toBe(2);
      expect(eta).toBeGreaterThan(0);
    });
  });

  // ─── the bill ─────────────────────────────────────────────────────────────

  describe('not spending money', () => {
    it('routes once for a burst of position reports', async () => {
      // The case that decides whether this feature is affordable. A report
      // arrives every few seconds per ride; one lookup each would cost roughly
      // $0.60 on a half-hour trip, against a ceiling of $0.50 a ride.
      const { driver, rideId } = await drivingRide();
      const routing = spyOnRouting();

      for (let i = 0; i < 6; i++) {
        await report(driver.accessToken, rideId).expect(201);
      }

      expect(routing).toHaveBeenCalledTimes(1);
    });

    it('routes once for a whole flushed queue, not once per reading', async () => {
      // A batch drained after a tunnel holds twenty positions. Routing each of
      // them would bill twenty lookups to answer a question about where the
      // car is now.
      const { driver, rideId } = await drivingRide();
      const routing = spyOnRouting();

      await authed(harness, driver.accessToken)
        .post(`/api/v1/driver/rides/${rideId}/locations`)
        .send({
          points: Array.from({ length: 20 }, (_, i) => ({
            latitude: 40.651 + i * 0.0001,
            longitude: -73.958,
            accuracyMeters: 9,
            capturedAt: new Date(Date.now() - (20 - i) * 1000).toISOString(),
          })),
        })
        .expect(201);

      expect(routing).toHaveBeenCalledTimes(1);
    });

    it('asks again when the car has gone somewhere the route did not expect', async () => {
      // A wrong turn. The cached answer described a journey the car is no
      // longer making, and counting it down would walk a family towards a
      // pickup the driver is heading away from.
      //
      // Tested through position rather than through time deliberately: the
      // clock rule is asserted where the clock can be controlled — in the
      // domain and the service specs — and what is worth proving here is that
      // a real report from a real endpoint reaches that rule at all.
      const { driver, rideId } = await drivingRide();
      const routing = spyOnRouting();

      await report(driver.accessToken, rideId).expect(201);
      await report(driver.accessToken, rideId, { latitude: 40.685 }).expect(201);

      expect(routing).toHaveBeenCalledTimes(2);
    });
  });

  // ─── the vendor is down ───────────────────────────────────────────────────

  describe('when routing is unavailable', () => {
    it('still gives the family a number', async () => {
      // A straight line at a conservative average is worse than a real route
      // and enormously better than a blank space where an arrival time was.
      const { driver, rideId } = await drivingRide();
      spyOnRouting().mockRejectedValue(new Error('vendor down'));

      await report(driver.accessToken, rideId).expect(201);

      expect(await etaOf(rideId)).toBeGreaterThan(0);
    });

    it('does not fail the position report itself', async () => {
      // The position is the thing that matters. A vendor outage must cost an
      // estimate, never a driver's upload — which they would then retry, on
      // the connection that has just come back.
      const { driver, rideId } = await drivingRide();
      spyOnRouting().mockRejectedValue(new Error('vendor down'));

      await report(driver.accessToken, rideId).expect(201);

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.lastLatitude).toBeCloseTo(40.651);
    });
  });
});
