import type { Response } from 'supertest';

import type { TestHarness } from './harness';

/**
 * Fixture builders.
 *
 * Every one of them goes through the HTTP API rather than writing rows
 * directly, with one deliberate exception (`verifyEmail`, which reaches into
 * the token table because the alternative is parsing an email in every setup
 * block). Building fixtures through the API means a test's setup exercises the
 * same validation and authorisation the product does — a fixture that cannot
 * be created through the API is a fixture that describes a state the system
 * cannot actually reach, and tests written against it prove nothing.
 */

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

let sequence = 0;

/** Obviously fictional, and unique per call so tests cannot collide. */
export function uniqueEmail(prefix = 'user'): string {
  sequence += 1;
  return `${prefix}.${sequence}.${Date.now().toString(36)}@example.test`;
}

export async function registerUser(
  harness: TestHarness,
  overrides: Partial<{ email: string; password: string; fullName: string }> = {},
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'correct-horse-battery-staple';

  const response = await harness.http
    .post('/api/v1/auth/register')
    .send({
      fullName: overrides.fullName ?? 'Ada Okonkwo',
      email,
      password,
      acceptedTerms: true,
    })
    .expect(201);

  const body = response.body as {
    accessToken: string;
    refreshToken: string;
    state: { user: { id: string } };
  };

  return {
    userId: body.state.user.id,
    email: email.toLowerCase(),
    password,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

/**
 * Marks an address verified without going through the emailed link.
 *
 * The link *is* tested — in auth.e2e-spec.ts, end to end. Repeating that dance
 * in every setup block would make each test's intent harder to read than the
 * thing it is testing.
 */
export async function verifyEmail(harness: TestHarness, userId: string): Promise<void> {
  await harness.prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
}

export async function signIn(
  harness: TestHarness,
  user: { email: string; password: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await harness.http
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);

  return response.body as { accessToken: string; refreshToken: string };
}

export function authed(harness: TestHarness, token: string | null) {
  return {
    get: (path: string) => withAuth(harness.http.get(path), token),
    post: (path: string) => withAuth(harness.http.post(path), token),
    put: (path: string) => withAuth(harness.http.put(path), token),
    patch: (path: string) => withAuth(harness.http.patch(path), token),
    delete: (path: string) => withAuth(harness.http.delete(path), token),
  };
}

function withAuth<T extends { set: (k: string, v: string) => T }>(
  request: T,
  token: string | null,
): T {
  return token ? request.set('authorization', `Bearer ${token}`) : request;
}

export async function createPatient(
  harness: TestHarness,
  token: string,
  overrides: Partial<{ preferredName: string; phone: string }> = {},
): Promise<string> {
  const response = await authed(harness, token)
    .post('/api/v1/patients')
    .send({
      preferredName: overrides.preferredName ?? 'Margaret',
      phone: overrides.phone ?? '+1-555-0100',
      relationship: 'daughter',
      homeAddress: {
        label: 'Home',
        line1: '400 Parkside Avenue',
        city: 'Brooklyn',
        state: 'NY',
        postalCode: '11226',
      },
    })
    .expect(201);

  const state = response.body as {
    patients: Array<{ id: string; preferredName: string }>;
  };
  const created = state.patients.find(
    (p) => p.preferredName === (overrides.preferredName ?? 'Margaret'),
  );
  if (!created) throw new Error('Patient was not in the returned snapshot');
  return created.id;
}

export async function createClinic(
  harness: TestHarness,
  token: string,
  overrides: Partial<{ name: string; timeZone: string }> = {},
): Promise<string> {
  const name = overrides.name ?? 'Kings County Cardiology';

  const response = await authed(harness, token)
    .post('/api/v1/clinics')
    .send({
      name,
      phone: '+1-555-0180',
      timeZone: overrides.timeZone ?? 'America/New_York',
      address: {
        label: 'Clinic',
        line1: '451 Clarkson Avenue',
        city: 'Brooklyn',
        state: 'NY',
        postalCode: '11203',
      },
    })
    .expect(201);

  const state = response.body as { clinics: Array<{ id: string; name: string }> };
  const created = state.clinics.find((c) => c.name === name);
  if (!created) throw new Error('Clinic was not in the returned snapshot');
  return created.id;
}

export async function createAppointment(
  harness: TestHarness,
  token: string,
  input: { patientId: string; clinicId: string; startsAt?: Date },
): Promise<string> {
  const startsAt = input.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const response: Response = await authed(harness, token)
    .post('/api/v1/appointments')
    .send({
      patientId: input.patientId,
      clinicId: input.clinicId,
      startsAt: startsAt.toISOString(),
      expectedDurationMinutes: 45,
      type: 'specialist',
    })
    .expect(201);

  const state = response.body as {
    appointments: Array<{ id: string; startsAt: string }>;
  };
  const created = state.appointments.find(
    (a) => new Date(a.startsAt).getTime() === startsAt.getTime(),
  );
  if (!created) throw new Error('Appointment was not in the returned snapshot');
  return created.id;
}
