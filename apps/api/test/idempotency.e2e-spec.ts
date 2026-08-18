import { TestHarness, errorOf } from './support/harness';
import { registerUser, type TestUser } from './support/factories';

/**
 * Replay protection on the endpoints that create things.
 *
 * The failure being prevented is ordinary rather than adversarial: a family
 * taps "Request transport", the response is lost to a dropped connection, the
 * app retries, and a second car is booked for the same appointment. Both
 * requests are individually legal, so nothing in the ride state machine can
 * catch it — which is why this has to be tested at the seam where the retry
 * actually happens.
 */
describe('idempotency', () => {
  let harness: TestHarness;
  let user: TestUser;

  beforeAll(async () => {
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
    user = await registerUser(harness);
  });

  const createPatient = (key?: string, preferredName = 'Margaret') => {
    const request = harness.http
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${user.accessToken}`);

    if (key) request.set('Idempotency-Key', key);

    return request.send({
      preferredName,
      phone: '+1-555-0100',
      relationship: 'daughter',
      homeAddress: {
        label: 'Home',
        line1: '400 Parkside Avenue',
        city: 'Brooklyn',
        state: 'NY',
        postalCode: '11226',
      },
    });
  };

  const patientCount = () => harness.prisma.patient.count();

  it('performs the request once when it is retried with the same key', async () => {
    const key = 'retry-after-a-dropped-connection';

    const first = await createPatient(key).expect(201);
    const replay = await createPatient(key).expect(201);

    expect(await patientCount()).toBe(1);
    // Byte-for-byte the first response, not a fresh snapshot: the client is
    // being handed the answer it lost, and anything else makes a retry
    // observably different from the original.
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replay']).toBe('true');
  });

  it('performs it twice without a key, which is the behaviour being fixed', async () => {
    await createPatient().expect(201);
    await createPatient().expect(201);

    expect(await patientCount()).toBe(2);
  });

  it('treats a different body under the same key as a mistake, not a replay', async () => {
    // Two intentions sharing one key. Answering the second with the first
    // one's result would silently discard it — the patient the caller thought
    // they created would not exist.
    const key = 'same-key-different-intent';
    await createPatient(key, 'Eleanor Adeyemi').expect(201);

    const refused = await createPatient(key, 'Someone Else Entirely').expect(400);

    expect(errorOf(refused).message).toContain('different request');
    expect(await patientCount()).toBe(1);
  });

  it('keeps one caller key from colliding with another caller key', async () => {
    // The key is client-chosen, so "retry-1" is a name two people will pick.
    // Keyed by user, it is two claims; keyed by key alone, the second family
    // silently gets the first family's response.
    const shared = 'a-key-anyone-might-choose';
    await createPatient(shared).expect(201);

    const other = await registerUser(harness);
    await harness.http
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .set('Idempotency-Key', shared)
      .send({
        preferredName: 'Marguerite',
        phone: '+1-555-0111',
        relationship: 'son',
        homeAddress: {
          label: 'Home',
          line1: '4 Sea Cliff Avenue',
          city: 'Brooklyn',
          state: 'NY',
          postalCode: '11226',
        },
      })
      .expect(201);

    expect(await patientCount()).toBe(2);
  });

  it('refuses a key that is too short to be one', async () => {
    // It becomes a database key. A client generating one-character keys would
    // turn every user's first request into everyone else's replay.
    const refused = await createPatient('x').expect(400);
    expect(errorOf(refused).message).toContain('Idempotency-Key');
    expect(await patientCount()).toBe(0);
  });

  it('lets a failed request be retried with the same key', async () => {
    // Only successes are recorded. A client that hit a validation error and
    // fixed it must not be locked out of its own operation for a day.
    const key = 'first-attempt-was-rejected';

    await harness.http
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ preferredName: '', relationship: 'nonsense' })
      .expect(400);

    await createPatient(key).expect(201);
    expect(await patientCount()).toBe(1);
  });

  it('books one ride when the request is retried', async () => {
    // The case this exists for: two cars for one appointment, and a family
    // charged for both.
    const patient = await createPatient('setup-patient-for-the-ride').expect(201);
    const patientId = (patient.body as { patients: Array<{ id: string }> }).patients[0]!
      .id;

    const clinic = await harness.http
      .post('/api/v1/clinics')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        name: 'Kings County Cardiology',
        phone: '+1-555-0180',
        timeZone: 'America/New_York',
        address: {
          label: 'Clinic',
          line1: '451 Clarkson Avenue',
          city: 'Brooklyn',
          state: 'NY',
          postalCode: '11203',
        },
      })
      .expect(201);
    const clinicId = (clinic.body as { clinics: Array<{ id: string }> }).clinics[0]!.id;

    const appointment = await harness.http
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        patientId,
        clinicId,
        type: 'specialist',
        startsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        expectedDurationMinutes: 45,
      })
      .expect(201);
    const appointmentId = (appointment.body as { appointments: Array<{ id: string }> })
      .appointments[0]!.id;

    // One body, sent twice — the retry a client makes is byte-identical, and a
    // timestamp recomputed per call would be a different request rather than a
    // replay.
    const body = {
      appointmentId,
      pickupAt: new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000,
      ).toISOString(),
      roundTrip: false,
    };

    const requestTransport = () =>
      harness.http
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .set('Idempotency-Key', 'the-connection-dropped-mid-booking')
        .send(body);

    await requestTransport().expect(201);
    await requestTransport().expect(201);

    expect(await harness.prisma.ride.count()).toBe(1);
  });
});
