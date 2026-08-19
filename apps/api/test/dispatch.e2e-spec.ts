import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  registerUser,
  verifyEmail,
} from './support/factories';
import { expectsIndistinguishableDenial } from './support/negative-paths';

/**
 * The operator's side of a ride.
 *
 * Two things here are worth more than the rest. The first is that approving a
 * driver *moves money* — the seat ledger and the subscription are updated in
 * the same transaction — and the second is that assignment eligibility is
 * asserted rather than advised, because a dispatcher under pressure at 8am
 * should not be the last line of defence against a saloon car meeting a
 * wheelchair.
 */
let organizationSequence = 0;
let plateSequence = 0;

describe('dispatch', () => {
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

  async function operator(options: { subscribe?: boolean } = {}) {
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

    if (options.subscribe ?? true) {
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
        .send({ planCode: 'dispatch-core', interval: 'monthly' })
        .expect(201);
    }

    return { owner, outsider, organizationId: organization.id };
  }

  async function addVehicle(
    token: string,
    organizationId: string,
    accessible: boolean,
  ): Promise<string> {
    const response = await authed(harness, token)
      .post(`/api/v1/organizations/${organizationId}/vehicles`)
      .send({
        make: accessible ? 'Ford' : 'Toyota',
        model: accessible ? 'Transit' : 'Sienna',
        color: 'White',
        licensePlate: `OH-${(plateSequence += 1).toString().padStart(4, '0')}`,
        isWheelchairAccessible: accessible,
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function addDriver(
    token: string,
    organizationId: string,
    vehicleId: string,
    displayName = 'Marcus T.',
  ): Promise<string> {
    const response = await authed(harness, token)
      .post(`/api/v1/organizations/${organizationId}/drivers`)
      .send({ displayName, vehicleId })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function approve(token: string, organizationId: string, driverId: string) {
    await authed(harness, token)
      .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
      .send({ to: 'pendingApproval' })
      .expect(201);
    return authed(harness, token)
      .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
      .send({ to: 'approved' })
      .expect(201);
  }

  async function bookedRide(options: { wheelchair?: boolean } = {}) {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);

    const patientId = await createPatient(harness, user.accessToken, {
      preferredName: 'Margaret',
      ...(options.wheelchair ? { mobilityNeeds: ['wheelchair'] } : {}),
    });
    const clinicId = await createClinic(harness, user.accessToken, {
      name: 'Kings County Cardiology',
    });
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
    });

    await authed(harness, user.accessToken)
      .post('/api/v1/rides')
      .send({
        appointmentId,
        pickupAt: new Date(Date.now() + 36 * 3600_000).toISOString(),
        roundTrip: false,
      })
      .expect(201);

    const ride = await harness.prisma.ride.findFirstOrThrow({ where: { patientId } });
    return { user, rideId: ride.id };
  }

  // ─── the roster ───────────────────────────────────────────────────────────

  describe('the roster', () => {
    it('adds a driver without billing for them yet', async () => {
      // A roster can be built before anybody has handed in a licence. The seat
      // moves at approval and nowhere else.
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      await addDriver(owner.accessToken, organizationId, vehicleId);

      const response = await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organizationId}/seats`)
        .expect(200);

      const seats = response.body as { activeDrivers: number; billedSeats: number };
      expect(seats.activeDrivers).toBe(0);
      expect(seats.billedSeats).toBe(0);
    });

    it('takes a billable seat at approval and writes the ledger entry', async () => {
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      const driverId = await addDriver(owner.accessToken, organizationId, vehicleId);

      await approve(owner.accessToken, organizationId, driverId);

      const response = await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organizationId}/seats`)
        .expect(200);

      const seats = response.body as {
        activeDrivers: number;
        billedSeats: number;
        ledger: Array<{ change: string; seatsAfter: number; driverId: string }>;
      };

      expect(seats.activeDrivers).toBe(1);
      expect(seats.billedSeats).toBe(1);
      expect(seats.ledger[0]).toMatchObject({
        change: 'granted',
        seatsAfter: 1,
        driverId,
      });
    });

    it('releases the seat when a driver is suspended, and says why', async () => {
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      const driverId = await addDriver(owner.accessToken, organizationId, vehicleId);
      await approve(owner.accessToken, organizationId, driverId);

      // An unexplained suspension is a dispute nobody can settle later.
      const refused = await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'suspended' })
        .expect(400);
      expect(errorOf(refused).code).toBe('validation');

      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'suspended', reason: 'Licence expired' })
        .expect(201);

      const subscription = await harness.prisma.subscription.findFirstOrThrow({
        where: { billingAccount: { organizationId } },
      });

      // The next renewal drops, and the high-water mark does not — the seat
      // was paid for and stays usable until the period ends.
      expect(subscription.seats).toBe(0);
      expect(subscription.seatsPaidFor).toBe(1);
    });

    it('does not charge twice for a driver suspended and reinstated in one period', async () => {
      // The operator has already paid for this seat. Comparing against the
      // head count instead of the high-water mark would bill it again.
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      const driverId = await addDriver(owner.accessToken, organizationId, vehicleId);
      await approve(owner.accessToken, organizationId, driverId);

      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'suspended', reason: 'Under review' })
        .expect(201);
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'approved' })
        .expect(201);

      const entries = await harness.prisma.seatLedgerEntry.findMany({
        orderBy: { at: 'asc' },
      });

      expect(entries.map((e) => e.change)).toEqual(['granted', 'released', 'granted']);
      expect(entries.every((e) => e.prorationCents === 0)).toBe(true);
    });

    it('refuses a lifecycle jump the state machine does not allow', async () => {
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      const driverId = await addDriver(owner.accessToken, organizationId, vehicleId);

      const response = await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'approved' })
        .expect(409);

      expect(errorOf(response).code).toBe('invalid_transition');
    });

    it('will not put an unapproved driver on shift', async () => {
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      const driverId = await addDriver(owner.accessToken, organizationId, vehicleId);

      await authed(harness, owner.accessToken)
        .put(`/api/v1/organizations/${organizationId}/drivers/${driverId}/shift`)
        .send({ onShift: true })
        .expect(400);
    });

    it('takes a suspended driver off shift with them', async () => {
      // Leaving the flag set would offer dispatch somebody who cannot drive.
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      const driverId = await addDriver(owner.accessToken, organizationId, vehicleId);
      await approve(owner.accessToken, organizationId, driverId);

      await authed(harness, owner.accessToken)
        .put(`/api/v1/organizations/${organizationId}/drivers/${driverId}/shift`)
        .send({ onShift: true })
        .expect(200);

      const response = await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to: 'suspended', reason: 'Incident under review' })
        .expect(201);

      expect((response.body as { onShift: boolean }).onShift).toBe(false);
    });

    it('refuses a vehicle belonging to another company, indistinguishably', async () => {
      const first = await operator();
      const second = await operator();
      const theirVehicle = await addVehicle(
        second.owner.accessToken,
        second.organizationId,
        false,
      );

      await authed(harness, first.owner.accessToken)
        .post(`/api/v1/organizations/${first.organizationId}/drivers`)
        .send({ displayName: 'Marcus T.', vehicleId: theirVehicle })
        .expect(404);
    });
  });

  // ─── the queue ────────────────────────────────────────────────────────────

  describe('the queue', () => {
    it('orders by when the car is needed, not by when the request arrived', async () => {
      const { owner, organizationId } = await operator();
      const later = await bookedRide();
      const sooner = await bookedRide();

      await harness.prisma.ride.update({
        where: { id: sooner.rideId },
        data: { scheduledPickupAt: new Date(Date.now() + 20 * 60_000) },
      });

      const response = await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organizationId}/dispatch/queue`)
        .expect(200);

      const queue = response.body as {
        items: Array<{ rideId: string; urgency: string; patientName: string }>;
      };

      expect(queue.items[0]?.rideId).toBe(sooner.rideId);
      expect(queue.items[0]?.urgency).toBe('imminent');
      expect(queue.items[1]?.rideId).toBe(later.rideId);
      // A dispatcher is supposed to see who they are arranging a car for.
      expect(queue.items[0]?.patientName).toBe('Margaret');
    });

    it('says why each driver cannot take the trip, not just that they cannot', async () => {
      const { owner, organizationId } = await operator();
      const vehicleId = await addVehicle(owner.accessToken, organizationId, false);
      const driverId = await addDriver(owner.accessToken, organizationId, vehicleId);
      await approve(owner.accessToken, organizationId, driverId);
      await bookedRide({ wheelchair: true });

      const response = await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organizationId}/dispatch/queue`)
        .expect(200);

      const queue = response.body as {
        items: Array<{
          wheelchairRequired: boolean;
          candidates: Array<{ eligible: boolean; reasons: string[] }>;
        }>;
      };

      expect(queue.items[0]?.wheelchairRequired).toBe(true);
      const candidate = queue.items[0]?.candidates[0];
      expect(candidate?.eligible).toBe(false);
      // "Nobody is on shift" and "nobody has an accessible vehicle" need
      // different phone calls.
      expect(candidate?.reasons).toEqual(
        expect.arrayContaining(['offShift', 'noAccessibleVehicle']),
      );
    });

    it('is invisible to somebody outside the operator', async () => {
      const { owner, outsider, organizationId } = await operator();
      await bookedRide();
      void owner;

      await expectsIndistinguishableDenial({
        token: outsider.accessToken,
        forbidden: (token) =>
          authed(harness, token).get(
            `/api/v1/organizations/${organizationId}/dispatch/queue`,
          ),
        missing: (token) =>
          authed(harness, token).get(
            '/api/v1/organizations/00000000-0000-4000-8000-0000000000ff/dispatch/queue',
          ),
      });
    });
  });

  // ─── assignment ───────────────────────────────────────────────────────────

  describe('assignment', () => {
    async function readyOperator(accessible = false) {
      const op = await operator();
      const vehicleId = await addVehicle(
        op.owner.accessToken,
        op.organizationId,
        accessible,
      );
      const driverId = await addDriver(
        op.owner.accessToken,
        op.organizationId,
        vehicleId,
      );
      await approve(op.owner.accessToken, op.organizationId, driverId);
      await authed(harness, op.owner.accessToken)
        .put(`/api/v1/organizations/${op.organizationId}/drivers/${driverId}/shift`)
        .send({ onShift: true })
        .expect(200);
      return { ...op, driverId, vehicleId };
    }

    it('gives a ride to a driver and pins the operator to it', async () => {
      const { owner, organizationId, driverId } = await readyOperator();
      const { rideId } = await bookedRide();

      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId })
        .expect(201);

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });

      expect(ride.status).toBe('assigned');
      expect(ride.driverId).toBe(driverId);
      expect(ride.settledOrganizationId).toBe(organizationId);
      // The operator is on a per-driver plan, so the whole fare is theirs.
      expect(ride.platformFunding).toBe('operatorSubscription');
      expect(ride.platformFeeCents).toBe(0);
      expect(ride.operatorPayoutCents).toBe(ride.totalCents);
    });

    it('takes the per-ride cut when the operator has never subscribed', async () => {
      // The basis-points path exists so a pilot operator can start before
      // procurement finishes.
      const op = await operator({ subscribe: false });
      const vehicleId = await addVehicle(
        op.owner.accessToken,
        op.organizationId,
        false,
      );
      const driverId = await addDriver(
        op.owner.accessToken,
        op.organizationId,
        vehicleId,
      );
      await approve(op.owner.accessToken, op.organizationId, driverId);
      await authed(harness, op.owner.accessToken)
        .put(`/api/v1/organizations/${op.organizationId}/drivers/${driverId}/shift`)
        .send({ onShift: true })
        .expect(200);

      const { rideId } = await bookedRide();

      await authed(harness, op.owner.accessToken)
        .post(
          `/api/v1/organizations/${op.organizationId}/dispatch/rides/${rideId}/assign`,
        )
        .send({ driverId })
        .expect(201);

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.platformFunding).toBe('perRide');
      expect(ride.platformFeeCents).toBeGreaterThan(0);
      expect((ride.platformFeeCents ?? 0) + (ride.operatorPayoutCents ?? 0)).toBe(
        ride.totalCents,
      );
    });

    it('refuses an operator who had a plan and stopped paying for it', async () => {
      // They chose the seats model and then stopped. Quietly dropping them back
      // onto per-ride would reward exactly that.
      const { owner, organizationId, driverId } = await readyOperator();
      await harness.prisma.subscription.updateMany({ data: { status: 'expired' } });
      const { rideId } = await bookedRide();

      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId })
        .expect(400);
    });

    it('will not send a saloon car to a wheelchair trip', async () => {
      const { owner, organizationId, driverId } = await readyOperator(false);
      const { rideId } = await bookedRide({ wheelchair: true });

      const response = await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId })
        .expect(400);

      expect(errorOf(response).message).toContain('wheelchair-accessible');
    });

    it('will not give a driver a second passenger', async () => {
      const { owner, organizationId, driverId } = await readyOperator();
      const first = await bookedRide();
      const second = await bookedRide();

      await authed(harness, owner.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/dispatch/rides/${first.rideId}/assign`,
        )
        .send({ driverId })
        .expect(201);

      await authed(harness, owner.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/dispatch/rides/${second.rideId}/assign`,
        )
        .send({ driverId })
        .expect(400);
    });

    it('records that the first driver dropped it when a ride is moved', async () => {
      const { owner, organizationId, driverId, vehicleId } = await readyOperator();
      const second = await addDriver(
        owner.accessToken,
        organizationId,
        vehicleId,
        'Priya N.',
      );
      await approve(owner.accessToken, organizationId, second);
      await authed(harness, owner.accessToken)
        .put(`/api/v1/organizations/${organizationId}/drivers/${second}/shift`)
        .send({ onShift: true })
        .expect(200);

      const { rideId } = await bookedRide();

      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId })
        .expect(201);

      // A reassignment without a reason is refused: the timeline the family
      // reads back later would have a gap in it.
      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId: second })
        .expect(400);

      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId: second, reason: 'Vehicle broke down' })
        .expect(201);

      const history = await harness.prisma.rideStatusHistory.findMany({
        where: { rideId },
        orderBy: { at: 'asc' },
      });

      expect(history.map((h) => h.toStatus)).toEqual(
        expect.arrayContaining(['assigned', 'reassignmentRequired', 'assigned']),
      );

      const ride = await harness.prisma.ride.findUniqueOrThrow({
        where: { id: rideId },
      });
      expect(ride.driverId).toBe(second);
    });

    it('cannot be done by a dispatcher at another company', async () => {
      const { organizationId, driverId } = await readyOperator();
      const { outsider } = await operator();
      const { rideId } = await bookedRide();

      await authed(harness, outsider.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId })
        .expect(404);
    });

    it('writes an audit row naming the fields it changed', async () => {
      const { owner, organizationId, driverId } = await readyOperator();
      const { rideId } = await bookedRide();

      await authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/dispatch/rides/${rideId}/assign`)
        .send({ driverId })
        .expect(201);

      const audit = await harness.prisma.auditLog.findMany({
        where: { action: 'dispatch.ride_assigned', entityId: rideId },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.changedFields).toEqual(['driverId', 'status']);
    });
  });
});
