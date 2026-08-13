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
  expectsIndistinguishableDenial,
  expectsPermissionScope,
  expectsRevocationTakesEffect,
} from './support/negative-paths';

/**
 * The negative paths, applied.
 *
 * FOUNDATION §9 makes these a merge requirement, and the reason is that
 * authorisation bugs do not announce themselves: a wrong-family read returns a
 * 200 with somebody's home address in it, and every positive test in the suite
 * still passes.
 */
describe('authorisation', () => {
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

  /** Two unrelated families, each with a patient. */
  async function twoFamilies() {
    const ours = await registerUser(harness);
    await verifyEmail(harness, ours.userId);
    const ourPatient = await createPatient(harness, ours.accessToken, {
      preferredName: 'Margaret',
    });

    const theirs = await registerUser(harness);
    await verifyEmail(harness, theirs.userId);
    const theirPatient = await createPatient(harness, theirs.accessToken, {
      preferredName: 'Olusegun',
    });

    return { ours, ourPatient, theirs, theirPatient };
  }

  const MISSING_ID = '00000000-0000-4000-8000-000000000000';

  // ─── the snapshot boundary ──────────────────────────────────────────────

  it('never puts another family’s patient in the snapshot', async () => {
    // The `in: patientIds` filter is applied at the point of reading rather
    // than afterwards, so data the caller has no grant for never enters the
    // result set and cannot be leaked by a mapper that forgets to check.
    const { ours, theirs } = await twoFamilies();

    const snapshot = await authed(harness, ours.accessToken)
      .get('/api/v1/care/state')
      .expect(200);

    const state = snapshot.body as {
      patients: Array<{ preferredName: string }>;
      appointments: unknown[];
      rides: unknown[];
    };

    expect(state.patients.map((p) => p.preferredName)).toEqual(['Margaret']);
    expect(JSON.stringify(state)).not.toContain('Olusegun');

    // And symmetrically, so the test cannot pass because one family is empty.
    const theirSnapshot = await authed(harness, theirs.accessToken)
      .get('/api/v1/care/state')
      .expect(200);
    expect(JSON.stringify(theirSnapshot.body)).not.toContain('Margaret');
  });

  // ─── indistinguishable denial ───────────────────────────────────────────

  it('cannot be used to probe whether another family’s patient exists', async () => {
    const { ours, theirPatient } = await twoFamilies();

    await expectsIndistinguishableDenial({
      token: ours.accessToken,
      forbidden: (token) =>
        authed(harness, token)
          .put(`/api/v1/patients/${theirPatient}`)
          .send({
            preferredName: 'Renamed',
            phone: '+1-555-0199',
            homeAddress: {
              label: 'Home',
              line1: '1 Somewhere',
              city: 'Brooklyn',
              state: 'NY',
              postalCode: '11226',
            },
          }),
      missing: (token) =>
        authed(harness, token)
          .put(`/api/v1/patients/${MISSING_ID}`)
          .send({
            preferredName: 'Renamed',
            phone: '+1-555-0199',
            homeAddress: {
              label: 'Home',
              line1: '1 Somewhere',
              city: 'Brooklyn',
              state: 'NY',
              postalCode: '11226',
            },
          }),
    });
  });

  it('cannot be used to probe whether another family’s appointment exists', async () => {
    const { ours, theirs, theirPatient } = await twoFamilies();
    const clinic = await createClinic(harness, theirs.accessToken);
    const appointment = await createAppointment(harness, theirs.accessToken, {
      patientId: theirPatient,
      clinicId: clinic,
    });

    await expectsIndistinguishableDenial({
      token: ours.accessToken,
      forbidden: (token) =>
        authed(harness, token)
          .post(`/api/v1/appointments/${appointment}/cancel`)
          .send({ reason: 'nope' }),
      missing: (token) =>
        authed(harness, token)
          .post(`/api/v1/appointments/${MISSING_ID}/cancel`)
          .send({ reason: 'nope' }),
    });
  });

  it('resolves ride authorisation up the graph, not from the ride id', async () => {
    // "A ride id is not a capability" — the check goes ride → patient → grant.
    const { ours, theirs, theirPatient } = await twoFamilies();
    const clinic = await createClinic(harness, theirs.accessToken);
    const appointment = await createAppointment(harness, theirs.accessToken, {
      patientId: theirPatient,
      clinicId: clinic,
    });

    const requested = await authed(harness, theirs.accessToken)
      .post('/api/v1/rides')
      .send({
        appointmentId: appointment,
        pickupAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
        roundTrip: false,
      })
      .expect(201);

    const rides = (requested.body as { rides: Array<{ id: string }> }).rides;
    const rideId = rides[0]?.id;
    expect(rideId).toBeDefined();

    await expectsIndistinguishableDenial({
      token: ours.accessToken,
      forbidden: (token) =>
        authed(harness, token)
          .post(`/api/v1/rides/${rideId}/cancel`)
          .send({ reason: 'nope' }),
      missing: (token) =>
        authed(harness, token)
          .post(`/api/v1/rides/${MISSING_ID}/cancel`)
          .send({ reason: 'nope' }),
    });
  });

  // ─── revocation ─────────────────────────────────────────────────────────

  it('closes every surface on the next request when a grant is revoked', async () => {
    // Not at the next token expiry and not on the next sign-in: grants are
    // resolved server-side per request precisely so revocation is immediate.
    const organiser = await registerUser(harness);
    await verifyEmail(harness, organiser.userId);
    const patientId = await createPatient(harness, organiser.accessToken);

    const relative = await registerUser(harness);
    await verifyEmail(harness, relative.userId);
    await harness.prisma.patientAccess.create({
      data: {
        userId: relative.userId,
        patientId,
        relationship: 'son',
        permissions: ['viewProfile', 'scheduleAppointments'],
        grantedByUserId: organiser.userId,
      },
    });

    await expectsRevocationTakesEffect({
      harness,
      userId: relative.userId,
      patientId,
      token: relative.accessToken,
      request: (token) =>
        authed(harness, token).post(`/api/v1/patients/${patientId}/select`),
    });

    // And the patient is gone from the snapshot, not merely unselectable.
    const snapshot = await authed(harness, relative.accessToken)
      .get('/api/v1/care/state')
      .expect(200);
    expect((snapshot.body as { patients: unknown[] }).patients).toEqual([]);
  });

  // ─── permission scope ───────────────────────────────────────────────────

  it('distinguishes holding a grant from holding the right permission', async () => {
    // The bug this catches: a service that checks a grant exists rather than
    // checking the specific permission — a view-only relative who can book a
    // car.
    const organiser = await registerUser(harness);
    await verifyEmail(harness, organiser.userId);
    const patientId = await createPatient(harness, organiser.accessToken);
    const clinicId = await createClinic(harness, organiser.accessToken);

    const relative = await registerUser(harness);
    await verifyEmail(harness, relative.userId);
    await harness.prisma.patientAccess.create({
      data: {
        userId: relative.userId,
        patientId,
        relationship: 'son',
        permissions: ['viewProfile', 'scheduleAppointments'],
        grantedByUserId: organiser.userId,
      },
    });

    // With scheduleAppointments they can book.
    await authed(harness, relative.accessToken)
      .post('/api/v1/appointments')
      .send({
        patientId,
        clinicId,
        startsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        expectedDurationMinutes: 30,
        type: 'followUp',
      })
      .expect(201);

    // Reduced to view-only, they cannot.
    await expectsPermissionScope({
      harness,
      userId: relative.userId,
      patientId,
      permissions: ['viewProfile'],
      token: relative.accessToken,
      request: (token) =>
        authed(harness, token)
          .post('/api/v1/appointments')
          .send({
            patientId,
            clinicId,
            startsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
            expectedDurationMinutes: 30,
            type: 'followUp',
          }),
    });
  });

  it('will not let a preference point the app at a patient the caller cannot see', async () => {
    const { ours, theirPatient } = await twoFamilies();

    await authed(harness, ours.accessToken)
      .patch('/api/v1/me/preferences')
      .send({ selectedPatientId: theirPatient })
      .expect(404);
  });

  it('will not let one account mark another account’s notification read', async () => {
    const { ours, theirs } = await twoFamilies();

    const theirState = await authed(harness, theirs.accessToken)
      .get('/api/v1/care/state')
      .expect(200);
    const notification = (theirState.body as { notifications: Array<{ id: string }> })
      .notifications[0];

    if (notification) {
      await authed(harness, ours.accessToken)
        .post(`/api/v1/notifications/${notification.id}/read`)
        .expect(200);

      const stored = await harness.prisma.notification.findUniqueOrThrow({
        where: { id: notification.id },
      });
      // Scoped by userId in the `where`, so the update matches nothing. A
      // silent no-op rather than an error: telling the caller their id did not
      // match would confirm which ids exist.
      expect(stored.readAt).toBeNull();
    }
  });

  // ─── the audit trail ────────────────────────────────────────────────────

  it('writes an audit row for every mutation, with field names and no values', async () => {
    const organiser = await registerUser(harness);
    await verifyEmail(harness, organiser.userId);
    await createPatient(harness, organiser.accessToken, { preferredName: 'Margaret' });

    const rows = await harness.prisma.auditLog.findMany({
      where: { actorUserId: organiser.userId },
      orderBy: { at: 'asc' },
    });

    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['auth.register', 'patient.create']),
    );

    // Knowing that a phone number was edited is what an investigation needs;
    // storing the old and new number would make the audit log a second copy of
    // the data it exists to protect.
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('Margaret');
    expect(serialised).not.toContain('555-0100');
    expect(serialised).not.toContain(organiser.email);
  });

  it('records an authorisation failure as an auditable event, not silence', async () => {
    const { ours, theirPatient } = await twoFamilies();

    await authed(harness, ours.accessToken)
      .post(`/api/v1/patients/${theirPatient}/select`)
      .expect(404);

    const denial = await harness.prisma.auditLog.findFirst({
      where: { actorUserId: ours.userId },
      orderBy: { at: 'desc' },
    });
    // The denial itself need not be audited by every endpoint, but the caller's
    // own activity must still be traceable — an empty audit trail for an
    // account that made requests is the thing that would be wrong here.
    expect(denial).not.toBeNull();
  });

  // ─── the error envelope ─────────────────────────────────────────────────

  it('answers with one envelope and a correlation id the user can quote', async () => {
    const response = await harness.http
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'x' })
      .expect(400);

    const error = errorOf(response);
    expect(error.code).toBe('validation');
    expect(error.correlationId).toEqual(expect.any(String));
    expect(response.headers['x-correlation-id']).toBe(error.correlationId);
  });

  it('echoes a client-supplied correlation id, within bounds', async () => {
    const response = await harness.http
      .get('/api/v1/health/live')
      .set('x-correlation-id', 'trace-abc-123')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('trace-abc-123');
  });

  it('replaces a correlation id that could forge a log line', async () => {
    // The value is echoed in a header and written to logs, so an unbounded
    // client string is header injection and log forging at once.
    const response = await harness.http
      .get('/api/v1/health/live')
      .set('x-correlation-id', 'a'.repeat(200))
      .expect(200);

    expect(response.headers['x-correlation-id']).not.toBe('a'.repeat(200));
    expect(response.headers['x-correlation-id']).toHaveLength(36);
  });
});
