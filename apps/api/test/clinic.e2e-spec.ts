import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  registerUser,
  verifyEmail,
  type TestUser,
} from './support/factories';

/**
 * The clinic portal.
 *
 * Two things are being proved. The first is the feature: a `flexibleReturn`
 * ride has been sitting in the schema since Stage 3 waiting for somebody to
 * say the visit was over, and this is the thing that says it.
 *
 * The second is the boundary. A clinic knows a great deal about its own
 * patients — but it knows it as a clinic. What CareBridge holds is a
 * **family's** record of somebody, and the portal must not become a second
 * route into it.
 */
let networkSequence = 0;

describe('the clinic portal', () => {
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

  async function network(kind: 'clinicNetwork' | 'dispatchCompany' = 'clinicNetwork') {
    const staff = await registerUser(harness);

    const organization = await harness.prisma.organization.create({
      data: {
        kind,
        name: 'Riverbend Health',
        slug: `riverbend-${(networkSequence += 1).toString(36)}-${Date.now().toString(36)}`,
        contactEmail: 'reception@riverbend.example',
      },
    });
    await harness.prisma.organizationMembership.create({
      data: { userId: staff.userId, organizationId: organization.id, role: 'owner' },
    });

    return { staff, organizationId: organization.id };
  }

  /** A family, a patient, a clinic and a round trip booked at it. */
  async function bookedRoundTrip(): Promise<{
    family: TestUser;
    clinicId: string;
    appointmentId: string;
    patientId: string;
  }> {
    const family = await registerUser(harness);
    await verifyEmail(harness, family.userId);

    const patientId = await createPatient(harness, family.accessToken, {
      preferredName: 'Margaret',
      phone: '+1-555-0147',
    });
    const clinicId = await createClinic(harness, family.accessToken, {
      name: 'Riverbend Cardiology',
    });
    const appointmentId = await createAppointment(harness, family.accessToken, {
      patientId,
      clinicId,
      startsAt: new Date(Date.now() + 3 * 3600_000),
    });

    await authed(harness, family.accessToken)
      .post('/api/v1/rides')
      .send({
        appointmentId,
        pickupAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        // Two rides sharing a group id. The return leg is created without a
        // time, because nobody knows when a cardiology follow-up will finish.
        roundTrip: true,
      })
      .expect(201);

    return { family, clinicId, appointmentId, patientId };
  }

  async function claimedNetwork() {
    const { staff, organizationId } = await network();
    const booking = await bookedRoundTrip();

    await authed(harness, staff.accessToken)
      .post(
        `/api/v1/organizations/${organizationId}/clinic/sites/${booking.clinicId}/claim`,
      )
      .send({})
      .expect(201);

    return { staff, organizationId, ...booking };
  }

  function day(staff: TestUser, organizationId: string) {
    return authed(harness, staff.accessToken).get(
      `/api/v1/organizations/${organizationId}/clinic/day`,
    );
  }

  // ─── claiming ─────────────────────────────────────────────────────────────

  describe('claiming a site', () => {
    it('attaches a record a family created', async () => {
      const { staff, organizationId, clinicId } = await claimedNetwork();

      const response = await authed(harness, staff.accessToken)
        .get(`/api/v1/organizations/${organizationId}/clinic/sites`)
        .expect(200);

      const sites = response.body as Array<{ id: string; name: string }>;
      expect(sites.map((s) => s.id)).toContain(clinicId);
    });

    it('is audited, because it grants sight of every appointment there', async () => {
      const { clinicId } = await claimedNetwork();

      const audit = await harness.prisma.auditLog.findFirst({
        where: { action: 'clinic.site_claimed', entityId: clinicId },
      });
      expect(audit).not.toBeNull();
    });

    it('will not take a site another network already holds', async () => {
      const { clinicId } = await claimedNetwork();
      const rival = await network();

      const response = await authed(harness, rival.staff.accessToken)
        .post(
          `/api/v1/organizations/${rival.organizationId}/clinic/sites/${clinicId}/claim`,
        )
        .send({})
        .expect(400);

      expect(errorOf(response).message).toMatch(/already claimed/i);
    });

    it('is not something a transport operator can do', async () => {
      // A dispatcher pointing this at their own organisation id must not be
      // able to read a waiting room.
      const operator = await network('dispatchCompany');
      const booking = await bookedRoundTrip();

      await authed(harness, operator.staff.accessToken)
        .post(
          `/api/v1/organizations/${operator.organizationId}/clinic/sites/${booking.clinicId}/claim`,
        )
        .send({})
        .expect(404);
    });
  });

  // ─── the day ──────────────────────────────────────────────────────────────

  describe('the day’s list', () => {
    it('shows who is expected and when', async () => {
      const { staff, organizationId, appointmentId } = await claimedNetwork();

      const response = await day(staff, organizationId).expect(200);
      const body = response.body as {
        arrivals: Array<{ appointmentId: string; patientName: string; stage: string }>;
      };

      expect(body.arrivals).toHaveLength(1);
      expect(body.arrivals[0]?.appointmentId).toBe(appointmentId);
      expect(body.arrivals[0]?.patientName).toBe('Margaret');
      expect(body.arrivals[0]?.stage).toBe('expected');
    });

    it('shows no home address and no telephone number', async () => {
      // The boundary. A clinic knows its own patients; this portal must not
      // become a second route into a family's record of somebody.
      const { staff, organizationId } = await claimedNetwork();

      const response = await day(staff, organizationId).expect(200);
      const serialised = JSON.stringify(response.body);

      expect(serialised).not.toMatch(/Parkside/);
      expect(serialised).not.toMatch(/555-0147/);
    });

    it('shows nothing at a site the network has not claimed', async () => {
      const { staff, organizationId } = await network();
      await bookedRoundTrip();

      const response = await day(staff, organizationId).expect(200);
      expect((response.body as { arrivals: unknown[] }).arrivals).toEqual([]);
    });

    it('refuses a caller with no membership at all', async () => {
      const { organizationId } = await claimedNetwork();
      const stranger = await registerUser(harness);

      await authed(harness, stranger.accessToken)
        .get(`/api/v1/organizations/${organizationId}/clinic/day`)
        .expect(404);
    });
  });

  // ─── checking in ──────────────────────────────────────────────────────────

  describe('checking a patient in', () => {
    it('is recorded separately from the ride completing', async () => {
      const { staff, organizationId, appointmentId } = await claimedNetwork();

      const response = await authed(harness, staff.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/check-in`,
        )
        .send({})
        .expect(201);

      const arrival = response.body as { stage: string; checkedInAt: string | null };
      expect(arrival.stage).toBe('checkedIn');
      expect(arrival.checkedInAt).not.toBeNull();
    });

    it('cannot be done twice', async () => {
      const { staff, organizationId, appointmentId } = await claimedNetwork();
      const url = `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/check-in`;

      await authed(harness, staff.accessToken).post(url).send({}).expect(201);
      const second = await authed(harness, staff.accessToken)
        .post(url)
        .send({})
        .expect(400);
      expect(errorOf(second).message).toMatch(/already checked in/i);
    });

    it('names the person who did it', async () => {
      const { staff, organizationId, appointmentId } = await claimedNetwork();
      await authed(harness, staff.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/check-in`,
        )
        .send({})
        .expect(201);

      const audit = await harness.prisma.auditLog.findFirst({
        where: { action: 'clinic.patient_checked_in', entityId: appointmentId },
      });
      expect(audit?.actorUserId).toBe(staff.userId);
    });

    it('refuses an appointment at somebody else’s site', async () => {
      const { appointmentId } = await claimedNetwork();
      const rival = await network();

      await authed(harness, rival.staff.accessToken)
        .post(
          `/api/v1/organizations/${rival.organizationId}/clinic/appointments/${appointmentId}/check-in`,
        )
        .send({})
        .expect(404);
    });
  });

  // ─── the feature this whole portal exists for ─────────────────────────────

  describe('sending the car home', () => {
    function ready(staff: TestUser, organizationId: string, appointmentId: string) {
      return authed(harness, staff.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/ready`,
        )
        .send({});
    }

    it('dispatches the return leg that was waiting for a time', async () => {
      // The `flexibleReturn` ride has been in the schema since Stage 3, booked
      // without a time because nobody knows when a follow-up will finish.
      // Nothing could tell it the time had come until now.
      const { staff, organizationId, appointmentId, patientId } =
        await claimedNetwork();

      const before = await harness.prisma.ride.findFirstOrThrow({
        where: { patientId, direction: 'returnTrip' },
      });
      expect(before.status).not.toBe('awaitingAssignment');

      await authed(harness, staff.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/check-in`,
        )
        .send({})
        .expect(201);

      const response = await ready(staff, organizationId, appointmentId).expect(201);
      expect((response.body as { stage: string }).stage).toBe('returning');

      const after = await harness.prisma.ride.findFirstOrThrow({
        where: { patientId, direction: 'returnTrip' },
      });
      expect(after.status).toBe('awaitingAssignment');
    });

    it('refuses for somebody who never arrived', async () => {
      // A wasted journey and a confused driver.
      const { staff, organizationId, appointmentId } = await claimedNetwork();

      const response = await ready(staff, organizationId, appointmentId).expect(400);
      expect(errorOf(response).message).toMatch(/arrived first/i);
    });

    it('will not send a second car', async () => {
      const { staff, organizationId, appointmentId } = await claimedNetwork();
      await authed(harness, staff.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/check-in`,
        )
        .send({})
        .expect(201);

      await ready(staff, organizationId, appointmentId).expect(201);
      const second = await ready(staff, organizationId, appointmentId).expect(400);
      expect(errorOf(second).message).toMatch(/already on the way/i);
    });

    it('shows the ride in the operator’s dispatch queue', async () => {
      // The clinic decides *when*. Who drives is still the operator's
      // decision, through the same queue every other ride goes into.
      const { staff, organizationId, appointmentId, patientId } =
        await claimedNetwork();
      await authed(harness, staff.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/check-in`,
        )
        .send({})
        .expect(201);
      await ready(staff, organizationId, appointmentId).expect(201);

      const ride = await harness.prisma.ride.findFirstOrThrow({
        where: { patientId, direction: 'returnTrip' },
      });
      const history = await harness.prisma.rideStatusHistory.findFirst({
        where: { rideId: ride.id, toStatus: 'awaitingAssignment' },
      });
      expect(history?.actor).toBe('Clinic');
    });

    it('counts how long somebody has been waiting', async () => {
      // The person who pressed the button is standing next to somebody in a
      // coat by the door.
      const { staff, organizationId, appointmentId } = await claimedNetwork();
      await authed(harness, staff.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/clinic/appointments/${appointmentId}/check-in`,
        )
        .send({})
        .expect(201);
      await ready(staff, organizationId, appointmentId).expect(201);

      await harness.prisma.appointment.update({
        where: { id: appointmentId },
        data: { readyForReturnAt: new Date(Date.now() - 40 * 60_000) },
      });

      const response = await day(staff, organizationId).expect(200);
      const body = response.body as {
        overdueReturns: number;
        arrivals: Array<{ waitingMinutes: number | null; overdue: boolean }>;
      };
      expect(body.arrivals[0]?.waitingMinutes).toBeGreaterThanOrEqual(40);
      expect(body.arrivals[0]?.overdue).toBe(true);
      expect(body.overdueReturns).toBe(1);
    });
  });
});
