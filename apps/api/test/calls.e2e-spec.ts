import { createHmac } from 'node:crypto';

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
import { RidesService } from '../src/modules/care/rides.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/**
 * Relay calls. ADR-0014.
 *
 * What must hold: the pairs are the ones the rules allow and no others; no
 * phone number is ever returned to a client or written to the call log; a
 * missed call is raised only when the callee's phone actually rang; and the
 * provider's webhooks change nothing unless they are signed.
 */

let organizationSequence = 0;
let plateSequence = 7000;

interface Target {
  kind: string;
  id: string;
  label: string;
  available: boolean;
  unavailableReason: string | null;
}

interface Call {
  id: string;
  status: string;
  calleeKind: string;
  durationSeconds: number | null;
}

/** Polls until `read` returns a non-empty list, or two seconds pass. */
async function eventually<T>(read: () => Promise<T[]>): Promise<T[]> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const rows = await read();
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Fixtures shared by both harnesses below. */
function fixtures(get: () => TestHarness) {
  async function operator() {
    const harness = get();
    const owner = await registerUser(harness, { fullName: 'Dana Whitfield' });
    const organization = await harness.prisma.organization.create({
      data: {
        name: 'Meridian Transit Partners',
        slug: `calls-${(organizationSequence += 1).toString(36)}-${Date.now().toString(36)}`,
        contactEmail: 'dispatch@operator.example',
        phone: '(614) 555-0110',
      },
    });
    await harness.prisma.organizationMembership.create({
      data: { userId: owner.userId, organizationId: organization.id, role: 'owner' },
    });
    await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
      .send({ planCode: 'dispatch-core', interval: 'monthly' })
      .expect(201);
    await authed(harness, owner.accessToken)
      .put('/api/v1/calls/my-number')
      .send({ phone: '614-555-0120' })
      .expect(200);
    return { owner, organizationId: organization.id };
  }

  async function driver(
    op: { owner: TestUser; organizationId: string },
    phone: string | null = '614-555-0130',
  ) {
    const harness = get();
    const token = op.owner.accessToken;
    const vehicle = await authed(harness, token)
      .post(`/api/v1/organizations/${op.organizationId}/vehicles`)
      .send({
        make: 'Toyota',
        model: 'Sienna',
        color: 'Silver',
        licensePlate: `CL-${(plateSequence += 1)}`,
        isWheelchairAccessible: false,
      })
      .expect(201);
    const email = uniqueEmail('driver');
    const account = await registerUser(harness, { email, fullName: 'Marcus Thompson' });
    await verifyEmail(harness, account.userId);
    const created = await authed(harness, token)
      .post(`/api/v1/organizations/${op.organizationId}/drivers`)
      .send({
        displayName: 'Marcus T.',
        vehicleId: (vehicle.body as { id: string }).id,
        email,
      })
      .expect(201);
    const driverId = (created.body as { id: string }).id;
    await giveDriverPaperwork(harness, driverId, op.owner.userId);
    for (const to of ['pendingApproval', 'approved']) {
      await authed(harness, token)
        .post(`/api/v1/organizations/${op.organizationId}/drivers/${driverId}/status`)
        .send({ to })
        .expect(201);
    }
    await authed(harness, token)
      .put(`/api/v1/organizations/${op.organizationId}/drivers/${driverId}/shift`)
      .send({ onShift: true })
      .expect(200);
    await authed(harness, account.accessToken).get('/api/v1/driver/me').expect(200);
    if (phone) {
      await authed(harness, account.accessToken)
        .put('/api/v1/calls/my-number')
        .send({ phone })
        .expect(200);
    }
    return { driverId, account };
  }

  async function ride(
    op: { owner: TestUser; organizationId: string },
    driverId: string,
  ) {
    const harness = get();
    const family = await registerUser(harness, { fullName: 'Sarah Lindqvist' });
    await verifyEmail(harness, family.userId);
    const patientId = await createPatient(harness, family.accessToken, {
      preferredName: 'Eleanor',
      phone: '(614) 555-0148',
    });
    const clinicId = await createClinic(harness, family.accessToken, {
      name: 'Riverside Clinic',
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
    const row = await harness.prisma.ride.findFirstOrThrow({ where: { patientId } });
    await authed(harness, op.owner.accessToken)
      .post(
        `/api/v1/organizations/${op.organizationId}/dispatch/rides/${row.id}/assign`,
      )
      .set('Idempotency-Key', `assign-${row.id}`)
      .send({ driverId })
      .expect(201);
    return { family, patientId, rideId: row.id };
  }

  async function advance(rideId: string, statuses: string[]): Promise<void> {
    const harness = get();
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

  async function targets(user: TestUser, query: string): Promise<Target[]> {
    const response = await authed(get(), user.accessToken)
      .get(`/api/v1/calls/targets?${query}`)
      .expect(200);
    return response.body as Target[];
  }

  async function settle(callId: string, ms = 2_000): Promise<Call> {
    const harness = get();
    const deadline = Date.now() + ms;
    for (;;) {
      const call = await harness.prisma.callSession.findUniqueOrThrow({
        where: { id: callId },
      });
      if (
        ['completed', 'noAnswer', 'busy', 'failed', 'canceled'].includes(call.status)
      ) {
        return call;
      }
      if (Date.now() > deadline) throw new Error(`call stuck at ${call.status}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  return { operator, driver, ride, advance, targets, settle };
}

describe('relay calls', () => {
  let harness: TestHarness;
  const f = fixtures(() => harness);

  beforeAll(async () => {
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it('offers dispatch the patient, the family and the driver — and never a number', async () => {
    const op = await f.operator();
    const { driverId } = await f.driver(op);
    const { rideId } = await f.ride(op, driverId);

    const list = await f.targets(op.owner, `rideId=${rideId}`);
    expect(list.map((t) => [t.kind, t.label, t.available])).toEqual([
      ['patient', 'Eleanor (patient)', true],
      // Sarah has not set a number.
      ['familyMember', 'Sarah (daughter)', false],
      ['driver', 'Marcus T.', true],
    ]);
    expect(list[1]!.unavailableReason).toBe('No phone number on file.');
    // Not the patient's, the driver's or the dispatcher's, in any form.
    for (const target of list) {
      expect(Object.keys(target).sort()).toEqual([
        'available',
        'id',
        'kind',
        'label',
        'unavailableReason',
      ]);
      const { id: _id, ...shown } = target;
      expect(JSON.stringify(shown)).not.toMatch(/\d{4}/);
    }
  });

  it('bridges dispatch to the driver, logs no number, and notes the call in the thread', async () => {
    const op = await f.operator();
    const { driverId } = await f.driver(op);
    const { rideId } = await f.ride(op, driverId);
    const thread = await authed(harness, op.owner.accessToken)
      .post('/api/v1/conversations')
      .send({ kind: 'dispatchDriver', rideId })
      .expect(200);
    const conversationId = (thread.body as { id: string }).id;

    const started = await authed(harness, op.owner.accessToken)
      .post('/api/v1/calls')
      .send({ conversationId, callee: { kind: 'driver', id: driverId } })
      .expect(201);
    const call = await f.settle((started.body as Call).id);
    expect(call).toMatchObject({ status: 'completed', durationSeconds: 95 });

    const row = await harness.prisma.callSession.findUniqueOrThrow({
      where: { id: call.id },
    });
    expect(JSON.stringify(row)).not.toMatch(/0130|0120/);

    // Written just after the call ends, so waited for rather than read at once.
    const lines = await eventually(() =>
      harness.prisma.message.findMany({ where: { conversationId } }),
    );
    expect(lines.map((m) => [m.senderRole, m.body])).toEqual([
      ['system', 'Call · 2 min'],
    ]);
  });

  it('raises a missed call for the callee only when their phone rang', async () => {
    const op = await f.operator();
    // Ends in 0000: the log adapter lets it ring out.
    const { driverId, account } = await f.driver(op, '614-555-0000');
    const { rideId } = await f.ride(op, driverId);

    const started = await authed(harness, op.owner.accessToken)
      .post('/api/v1/calls')
      .send({ rideId, callee: { kind: 'driver', id: driverId } })
      .expect(201);
    expect((await f.settle((started.body as Call).id)).status).toBe('noAnswer');

    const missed = await eventually(() =>
      harness.prisma.notification.findMany({
        where: { userId: account.userId, kind: 'callMissed' },
      }),
    );
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ appTarget: 'driver', title: 'Missed call' });
    expect(missed[0]!.body).not.toMatch(/Dana|Meridian|Eleanor/);
  });

  it('lets the family call the driver only while the ride is under way, and dispatch always', async () => {
    const op = await f.operator();
    const { driverId } = await f.driver(op);
    const { family, rideId } = await f.ride(op, driverId);
    await authed(harness, family.accessToken)
      .put('/api/v1/calls/my-number')
      .send({ phone: '614 555 0199' })
      .expect(200);

    // Assigned, not yet accepted: no driver line.
    expect((await f.targets(family, `rideId=${rideId}`)).map((t) => t.kind)).toEqual([
      'dispatch',
    ]);
    await authed(harness, family.accessToken)
      .post('/api/v1/calls')
      .send({ rideId, callee: { kind: 'driver', id: driverId } })
      .expect(404);

    await f.advance(rideId, ['driverAccepted', 'driverEnRoute']);
    expect((await f.targets(family, `rideId=${rideId}`)).map((t) => t.kind)).toEqual([
      'dispatch',
      'driver',
    ]);

    await f.advance(rideId, [
      'driverArrived',
      'passengerOnboard',
      'inProgress',
      'arrivedAtDestination',
      'completed',
    ]);
    expect((await f.targets(family, `rideId=${rideId}`)).map((t) => t.kind)).toEqual([
      'dispatch',
    ]);
  });

  it('refuses outsiders, and anyone not named by the context', async () => {
    const op = await f.operator();
    const { driverId } = await f.driver(op);
    const { rideId, patientId } = await f.ride(op, driverId);
    const stranger = await registerUser(harness);

    await authed(harness, stranger.accessToken)
      .get(`/api/v1/calls/targets?rideId=${rideId}`)
      .expect(404);
    await authed(harness, stranger.accessToken)
      .post('/api/v1/calls')
      .send({ rideId, callee: { kind: 'patient', id: patientId } })
      .expect(404);

    // A real patient id, but not this ride's.
    const otherFamily = await registerUser(harness);
    const otherPatientId = await createPatient(harness, otherFamily.accessToken, {
      preferredName: 'Walter',
    });
    expect(otherPatientId).not.toBe(patientId);
    await authed(harness, op.owner.accessToken)
      .post('/api/v1/calls')
      .send({ rideId, callee: { kind: 'patient', id: otherPatientId } })
      .expect(404);
  });

  it('asks the caller for a number before placing a call, and refuses one it cannot dial', async () => {
    const op = await f.operator();
    const { driverId, account } = await f.driver(op, null);
    await f.ride(op, driverId);

    await authed(harness, account.accessToken)
      .put('/api/v1/calls/my-number')
      .send({ phone: '555-01' })
      .expect(400);

    const thread = await authed(harness, account.accessToken)
      .post('/api/v1/conversations')
      .send({ kind: 'dispatchDriver' })
      .expect(200);
    const list = await f.targets(
      account,
      `conversationId=${(thread.body as { id: string }).id}`,
    );
    expect(list).toEqual([
      expect.objectContaining({
        kind: 'dispatch',
        available: false,
        unavailableReason: 'Add your phone number in Settings to place calls.',
      }),
    ]);
  });
});

describe('relay call webhooks (Twilio)', () => {
  const AUTH_TOKEN = 'twilio-test-auth-token';
  const BASE = 'https://carebridge.example/api/v1';
  let harness: TestHarness;
  const f = fixtures(() => harness);
  const saved: Record<string, string | undefined> = {};
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    const env = {
      TELEPHONY_DRIVER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC-test',
      TWILIO_AUTH_TOKEN: AUTH_TOKEN,
      TELEPHONY_WEBHOOK_BASE_URL: BASE,
    };
    for (const [key, value] of Object.entries(env)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    await harness.reset();
    // The one outbound request: Twilio's "create call". Answered locally.
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ sid: 'CA-test' }), { status: 201 }),
      );
  });

  afterEach(() => fetchSpy.mockRestore());

  function sign(pathAndQuery: string, params: Record<string, string>): string {
    const payload =
      BASE +
      pathAndQuery +
      Object.keys(params)
        .sort()
        .map((k) => `${k}${params[k]}`)
        .join('');
    return createHmac('sha1', AUTH_TOKEN).update(payload).digest('base64');
  }

  function webhook(
    pathAndQuery: string,
    params: Record<string, string>,
    signed = true,
  ) {
    const request = harness.http
      .post(`/api/v1${pathAndQuery}`)
      .type('form')
      .send(params);
    return signed
      ? request.set('X-Twilio-Signature', sign(pathAndQuery, params))
      : request;
  }

  it('rings the caller first, then dials the callee from the relay number on answer', async () => {
    const op = await f.operator();
    const { driverId } = await f.driver(op);
    const { rideId } = await f.ride(op, driverId);

    const started = await authed(harness, op.owner.accessToken)
      .post('/api/v1/calls')
      .send({ rideId, callee: { kind: 'driver', id: driverId } })
      .expect(201);
    const callId = (started.body as Call).id;

    const [, init] = fetchSpy.mock.calls[0] as [string, { body: URLSearchParams }];
    // Leg one goes to the dispatcher's own phone; the callee is not sent yet.
    expect(init.body.get('To')).toBe('+16145550120');
    expect(init.body.toString()).not.toContain('5550130');

    const bridge = await webhook(`/telephony/voice/bridge?session=${callId}`, {
      CallSid: 'CA-test',
    }).expect(200);
    expect(bridge.text).toContain('+16145550130</Number>');
  });

  it('ignores unsigned webhooks entirely', async () => {
    const op = await f.operator();
    const { driverId } = await f.driver(op);
    const { rideId } = await f.ride(op, driverId);
    const started = await authed(harness, op.owner.accessToken)
      .post('/api/v1/calls')
      .send({ rideId, callee: { kind: 'driver', id: driverId } })
      .expect(201);
    const callId = (started.body as Call).id;

    const bridge = await webhook(
      `/telephony/voice/bridge?session=${callId}`,
      { CallSid: 'x' },
      false,
    ).expect(403);
    expect(bridge.text).not.toContain('555');

    await webhook(
      `/telephony/voice/dial-result?session=${callId}`,
      { DialCallStatus: 'no-answer' },
      false,
    ).expect(403);
    const row = await harness.prisma.callSession.findUniqueOrThrow({
      where: { id: callId },
    });
    expect(row.status).toBe('initiating');
  });

  it('moves the call on signed callbacks, in order, and raises the missed call', async () => {
    const op = await f.operator();
    const { driverId, account } = await f.driver(op);
    const { rideId } = await f.ride(op, driverId);
    const started = await authed(harness, op.owner.accessToken)
      .post('/api/v1/calls')
      .send({ rideId, callee: { kind: 'driver', id: driverId } })
      .expect(201);
    const callId = (started.body as Call).id;

    await webhook(`/telephony/status?session=${callId}&leg=caller`, {
      CallStatus: 'in-progress',
    }).expect(204);
    await webhook(`/telephony/status?session=${callId}&leg=callee`, {
      CallStatus: 'ringing',
    }).expect(204);
    await webhook(`/telephony/voice/dial-result?session=${callId}`, {
      DialCallStatus: 'no-answer',
    }).expect(200);

    // A late, duplicate "ringing" must not reopen it.
    await webhook(`/telephony/status?session=${callId}&leg=callee`, {
      CallStatus: 'ringing',
    }).expect(204);

    const row = await harness.prisma.callSession.findUniqueOrThrow({
      where: { id: callId },
    });
    expect(row.status).toBe('noAnswer');
    expect(
      await harness.prisma.notification.count({
        where: { userId: account.userId, kind: 'callMissed' },
      }),
    ).toBe(1);
  });

  it('puts a callback through to the dispatch line of the operator that rang', async () => {
    const op = await f.operator();
    const { driverId } = await f.driver(op);
    const { rideId } = await f.ride(op, driverId);
    await authed(harness, op.owner.accessToken)
      .post('/api/v1/calls')
      .send({
        rideId,
        callee: {
          kind: 'patient',
          id: (await harness.prisma.ride.findUniqueOrThrow({ where: { id: rideId } }))
            .patientId,
        },
      })
      .expect(201);

    const fromPatient = await webhook('/telephony/voice/inbound', {
      From: '+16145550148',
    }).expect(200);
    expect(fromPatient.text).toContain('+16145550110</Dial>');

    const fromStranger = await webhook('/telephony/voice/inbound', {
      From: '+16145559999',
    }).expect(200);
    expect(fromStranger.text).not.toContain('<Dial');
  });
});
