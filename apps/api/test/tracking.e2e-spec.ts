import { io, type Socket } from 'socket.io-client';

import { TestHarness } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  registerUser,
  verifyEmail,
  type TestUser,
} from './support/factories';
import { RidesService } from '../src/modules/care/rides.service';
import { TrackingAuthorizer } from '../src/modules/tracking/tracking.authorizer';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/**
 * Who may watch a car move, and for how long.
 *
 * FOUNDATION marks this a **P0 security surface**: a live position is a
 * vulnerable person's real-time physical location, and a WebSocket is the one
 * place in this system where an authorisation decision is made once and then
 * keeps paying out. Every negative case below is one FOUNDATION names, plus
 * the two that only exist because the subscription outlives the check —
 * revocation and a ride ending underneath an open socket.
 */

let organizationSequence = 0;
let plateSequence = 1000;

describe('live tracking', () => {
  let harness: TestHarness;
  let url: string;
  const open: Socket[] = [];

  beforeAll(async () => {
    harness = await TestHarness.create();
    // The rest of the suite runs against an initialised-but-not-listening
    // app, which is enough for supertest. A WebSocket needs a real port.
    await harness.app.listen(0);
    url = await harness.app.getUrl();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterEach(() => {
    for (const socket of open.splice(0)) socket.disconnect();
  });

  /** Connects to the tracking namespace with whatever credentials are given. */
  function connect(token: string | null): Socket {
    const socket = io(`${url.replace('[::1]', '127.0.0.1')}/tracking`, {
      path: '/api/v1/socket.io',
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
    });
    open.push(socket);
    return socket;
  }

  /**
   * Resolves true only if the socket is *still* connected a moment later.
   *
   * Socket.IO completes the client-side handshake before the server's
   * `handleConnection` has run, so a refused socket fires `connect` and is
   * dropped immediately afterwards. Resolving on `connect` alone would
   * therefore report every refusal as a success — which is the one direction
   * a test of an authorisation boundary must never be wrong in.
   */
  function connects(socket: Socket): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      socket.on('connect_error', () => settle(false));
      socket.on('disconnect', () => settle(false));
      socket.on('connect', () => {
        setTimeout(() => settle(socket.connected), 400);
      });
      setTimeout(() => settle(false), 4_000);
    });
  }

  function watch(socket: Socket, rideId: string): Promise<boolean> {
    return new Promise((resolve) => {
      socket.emit('watch', { rideId }, (reply: { watching?: boolean }) => {
        resolve(reply?.watching === true);
      });
      setTimeout(() => resolve(false), 4_000);
    });
  }

  function nextEvent<T>(socket: Socket, event: string, ms = 4_000): Promise<T | null> {
    return new Promise((resolve) => {
      socket.once(event, (payload: T) => resolve(payload));
      setTimeout(() => resolve(null), ms);
    });
  }

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

    const vehicle = await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/vehicles`)
      .send({
        make: 'Toyota',
        model: 'Sienna',
        color: 'Silver',
        licensePlate: `OH-${(plateSequence += 1)}`,
        isWheelchairAccessible: false,
      })
      .expect(201);

    const driver = await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/drivers`)
      .send({
        displayName: 'Marcus T.',
        vehicleId: (vehicle.body as { id: string }).id,
      })
      .expect(201);

    const driverId = (driver.body as { id: string }).id;
    for (const to of ['pendingApproval', 'approved']) {
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/drivers/${driverId}/status`)
        .send({ to })
        .expect(201);
    }

    // Approved is not enough to be assignable: `driverEligibility` also wants
    // them on shift, which is the whole point of the two being separate.
    await authed(harness, owner.accessToken)
      .put(`/api/v1/organizations/${organization.id}/drivers/${driverId}/shift`)
      .send({ onShift: true })
      .expect(200);

    return { owner, organizationId: organization.id, driverId };
  }

  /** A ride that has been assigned and is en route, so tracking is legal. */
  async function movingRide(): Promise<{
    family: TestUser;
    rideId: string;
    patientId: string;
    organizationId: string;
    owner: TestUser;
  }> {
    const { owner, organizationId, driverId } = await operator();

    const family = await registerUser(harness);
    await verifyEmail(harness, family.userId);

    const patientId = await createPatient(harness, family.accessToken, {
      preferredName: 'Margaret',
    });
    const clinicId = await createClinic(harness, family.accessToken, {
      name: 'Kings County Cardiology',
    });
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
      .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${ride.id}/assign`)
      .set('Idempotency-Key', `assign-${ride.id}`)
      .send({ driverId })
      .expect(201);

    await advance(ride.id, ['driverAccepted', 'driverEnRoute']);

    return { family, rideId: ride.id, patientId, organizationId, owner };
  }

  /** Drives a ride forward through the same service a driver's app would. */
  async function advance(rideId: string, statuses: string[]): Promise<void> {
    const rides = harness.app.get(RidesService);
    const prisma = harness.app.get(PrismaService);

    for (const to of statuses) {
      await prisma.$transaction((tx) =>
        rides.transition(tx, {
          rideId,
          to: to as never,
          at: new Date(),
          actor: 'test',
        }),
      );
    }
  }

  async function report(rideId: string): Promise<void> {
    const rides = harness.app.get(RidesService);
    const prisma = harness.app.get(PrismaService);
    const now = new Date();

    await prisma.$transaction((tx) =>
      rides.reportLocation(
        tx,
        rideId,
        {
          latitude: 40.651,
          longitude: -73.958,
          accuracyMeters: 10,
          capturedAt: now.toISOString(),
        },
        now,
      ),
    );
  }

  // ─── the handshake ────────────────────────────────────────────────────────

  describe('the handshake', () => {
    it('refuses a socket with no credentials', async () => {
      // Unauthenticated, this endpoint is a firehose of patient locations.
      expect(await connects(connect(null))).toBe(false);
    });

    it('refuses a socket with a token that is not one of ours', async () => {
      expect(await connects(connect('not-a-real-token'))).toBe(false);
    });

    it('accepts a signed-in user', async () => {
      const user = await registerUser(harness);
      expect(await connects(connect(user.accessToken))).toBe(true);
    });
  });

  // ─── who may watch ────────────────────────────────────────────────────────

  describe('subscribing to a ride', () => {
    it('lets the family who booked it watch, and sends the position', async () => {
      const { family, rideId } = await movingRide();
      await report(rideId);

      const socket = connect(family.accessToken);
      expect(await connects(socket)).toBe(true);

      const position = nextEvent<{ rideId: string; latitude: number }>(
        socket,
        'position',
      );
      expect(await watch(socket, rideId)).toBe(true);

      // Sent on subscribe, so a family opening the app mid-journey sees the
      // car at once rather than waiting for the next report.
      const received = await position;
      expect(received?.rideId).toBe(rideId);
      expect(received?.latitude).toBeCloseTo(40.651);
    });

    it('refuses an unrelated family', async () => {
      // Named in FOUNDATION. A ride id is not a capability: knowing one must
      // not be enough to watch somebody else's grandmother travel.
      const { rideId } = await movingRide();
      const stranger = await registerUser(harness);

      const socket = connect(stranger.accessToken);
      expect(await connects(socket)).toBe(true);
      expect(await watch(socket, rideId)).toBe(false);
    });

    it('refuses a ride that does not exist, identically', async () => {
      // Same answer as "not yours", so the refusal cannot be used to discover
      // which ride ids are real.
      const stranger = await registerUser(harness);
      const socket = connect(stranger.accessToken);
      expect(await connects(socket)).toBe(true);
      expect(await watch(socket, '00000000-0000-4000-8000-000000000000')).toBe(false);
    });

    it('lets a dispatcher at the operator carrying the ride watch', async () => {
      const { owner, rideId } = await movingRide();

      const socket = connect(owner.accessToken);
      expect(await connects(socket)).toBe(true);
      expect(await watch(socket, rideId)).toBe(true);
    });

    it('refuses a dispatcher at a different operator', async () => {
      const { rideId } = await movingRide();
      const other = await operator();

      const socket = connect(other.owner.accessToken);
      expect(await connects(socket)).toBe(true);
      expect(await watch(socket, rideId)).toBe(false);
    });

    it('refuses a subscription once the ride has completed', async () => {
      // Named in FOUNDATION's acceptance criteria. Location stops being
      // available when the ride ends, not when its last position expires.
      const { family, rideId } = await movingRide();
      await advance(rideId, [
        'driverArrived',
        'passengerOnboard',
        'inProgress',
        'arrivedAtDestination',
        'completed',
      ]);

      const socket = connect(family.accessToken);
      expect(await connects(socket)).toBe(true);
      expect(await watch(socket, rideId)).toBe(false);
    });
  });

  // ─── the stream itself ────────────────────────────────────────────────────

  describe('the stream', () => {
    it('pushes each new position to a watcher', async () => {
      const { family, rideId } = await movingRide();

      const socket = connect(family.accessToken);
      await connects(socket);
      expect(await watch(socket, rideId)).toBe(true);

      const position = nextEvent<{ latitude: number }>(socket, 'position');
      await report(rideId);
      expect(await position).not.toBeNull();
    });

    it('tells watchers when the ride ends, rather than going quiet', async () => {
      // A map that has silently stopped is indistinguishable from a car
      // stopped at lights. The end of a trip is information the screen needs.
      const { family, rideId } = await movingRide();

      const socket = connect(family.accessToken);
      await connects(socket);
      await watch(socket, rideId);

      const closed = nextEvent<{ reason: string }>(socket, 'closed');
      await advance(rideId, [
        'driverArrived',
        'passengerOnboard',
        'inProgress',
        'arrivedAtDestination',
        'completed',
      ]);

      expect((await closed)?.reason).toBe('ended');
    });

    it('stops serving a position once the ride is over', async () => {
      const { rideId } = await movingRide();
      await report(rideId);

      await advance(rideId, [
        'driverArrived',
        'passengerOnboard',
        'inProgress',
        'arrivedAtDestination',
        'completed',
      ]);

      // Forgotten from the live store, not merely left to expire: the TTL
      // would take up to two minutes, and for those two minutes a finished
      // trip's last position would still be readable.
      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.lastLatitude).toBeNull();
      expect(ride.lastCapturedAt).toBeNull();
    });
  });

  // ─── the rule underneath, checked directly ────────────────────────────────

  describe('the authorisation rule', () => {
    // Exercised directly rather than through a socket, because the gateway
    // re-runs it on a fifteen-second timer and a test should not wait for one.
    // These are the cases that only exist because a subscription outlives the
    // check that granted it.

    it('stops allowing a family member whose access has been revoked', async () => {
      const { family, rideId, patientId } = await movingRide();
      const authorizer = harness.app.get(TrackingAuthorizer);

      expect(await authorizer.canWatch(family.userId, rideId)).toBe(true);

      await harness.prisma.patientAccess.updateMany({
        where: { userId: family.userId, patientId },
        data: { revokedAt: new Date() },
      });

      // The classic bug in this shape is reading the grant without its
      // `revokedAt`: removing access appears to work everywhere it is
      // displayed and changes nothing about what is still received.
      expect(await authorizer.canWatch(family.userId, rideId)).toBe(false);
    });

    it('stops allowing a dispatcher whose membership has been revoked', async () => {
      const { owner, rideId, organizationId } = await movingRide();
      const authorizer = harness.app.get(TrackingAuthorizer);

      expect(await authorizer.canWatch(owner.userId, rideId)).toBe(true);

      await harness.prisma.organizationMembership.updateMany({
        where: { userId: owner.userId, organizationId },
        data: { revokedAt: new Date() },
      });

      expect(await authorizer.canWatch(owner.userId, rideId)).toBe(false);
    });

    it('stops allowing anyone once the ride reaches a terminal state', async () => {
      const { family, rideId } = await movingRide();
      const authorizer = harness.app.get(TrackingAuthorizer);

      expect(await authorizer.canWatch(family.userId, rideId)).toBe(true);
      await advance(rideId, [
        'driverArrived',
        'passengerOnboard',
        'inProgress',
        'arrivedAtDestination',
        'completed',
      ]);
      expect(await authorizer.canWatch(family.userId, rideId)).toBe(false);
    });
  });
});
