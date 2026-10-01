import { randomUUID } from 'node:crypto';

import { io, type Socket } from 'socket.io-client';

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
import { RIDE_THREAD_GRACE_MS } from '../src/domain/conversation-access';
import { RetentionService } from '../src/modules/retention/retention.service';

/**
 * Conversations between dispatch, families and drivers. ADR-0014.
 *
 * Membership is derived rather than stored, so most of what is worth proving
 * here is negative: that each of the edges it is derived from — a family
 * grant, a dispatching membership, a ride's current driver — takes someone
 * *out* of a thread the moment it changes, with nothing else updated.
 */

let organizationSequence = 0;
let plateSequence = 5000;

interface Conversation {
  id: string;
  kind: string;
  title: string;
  myRole: string;
  canPost: boolean;
  rideId: string | null;
  unreadCount: number;
  ride: { patientName: string } | null;
}

interface Message {
  id: string;
  body: string;
  senderLabel: string;
  senderRole: string;
  mine: boolean;
}

describe('messaging', () => {
  let harness: TestHarness;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    harness = await TestHarness.create();
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
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function operator(name = 'Meridian Transit Partners') {
    const owner = await registerUser(harness, { fullName: 'Dana Whitfield' });
    const organization = await harness.prisma.organization.create({
      data: {
        name,
        slug: `op-${(organizationSequence += 1).toString(36)}-${Date.now().toString(36)}`,
        contactEmail: 'dispatch@operator.example',
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

  /** An approved, on-shift driver whose account has claimed its roster place. */
  async function driver(
    op: { owner: TestUser; organizationId: string },
    displayName: string,
    options: { onShift?: boolean } = {},
  ): Promise<{ driverId: string; account: TestUser }> {
    const token = op.owner.accessToken;
    const vehicle = await authed(harness, token)
      .post(`/api/v1/organizations/${op.organizationId}/vehicles`)
      .send({
        make: 'Toyota',
        model: 'Sienna',
        color: 'Silver',
        licensePlate: `MS-${(plateSequence += 1)}`,
        isWheelchairAccessible: false,
      })
      .expect(201);

    const email = uniqueEmail('driver');
    const account = await registerUser(harness, { email, fullName: displayName });
    await verifyEmail(harness, account.userId);

    const created = await authed(harness, token)
      .post(`/api/v1/organizations/${op.organizationId}/drivers`)
      .send({ displayName, vehicleId: (vehicle.body as { id: string }).id, email })
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
      .send({ onShift: options.onShift ?? true })
      .expect(200);

    // Claims the roster place.
    await authed(harness, account.accessToken).get('/api/v1/driver/me').expect(200);
    return { driverId, account };
  }

  /** A family, a patient, and a ride assigned to `driverId` and under way. */
  async function assignedRide(
    op: { owner: TestUser; organizationId: string },
    driverId: string,
  ) {
    const family = await registerUser(harness, { fullName: 'Sarah Lindqvist' });
    await verifyEmail(harness, family.userId);
    const patientId = await createPatient(harness, family.accessToken, {
      preferredName: 'Eleanor',
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
    const ride = await harness.prisma.ride.findFirstOrThrow({ where: { patientId } });

    await authed(harness, op.owner.accessToken)
      .post(
        `/api/v1/organizations/${op.organizationId}/dispatch/rides/${ride.id}/assign`,
      )
      .set('Idempotency-Key', `assign-${ride.id}`)
      .send({ driverId })
      .expect(201);
    await advance(ride.id, ['driverAccepted', 'driverEnRoute']);

    return { family, patientId, rideId: ride.id };
  }

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

  async function open(user: TestUser, body: Record<string, unknown>, status = 200) {
    const response = await authed(harness, user.accessToken)
      .post('/api/v1/conversations')
      .send(body)
      .expect(status);
    return response.body as Conversation;
  }

  async function send(
    user: TestUser,
    conversationId: string,
    body: string,
    status = 201,
  ) {
    const response = await authed(harness, user.accessToken)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .send({ body, clientMessageId: randomUUID() })
      .expect(status);
    return response.body as Message;
  }

  async function inbox(user: TestUser): Promise<Conversation[]> {
    const response = await authed(harness, user.accessToken)
      .get('/api/v1/conversations')
      .expect(200);
    return response.body as Conversation[];
  }

  async function messages(user: TestUser, conversationId: string, status = 200) {
    const response = await authed(harness, user.accessToken)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .expect(status);
    return (response.body as { messages: Message[] }).messages;
  }

  function connect(token: string): Promise<Socket> {
    const socket = io(`${url.replace('[::1]', '127.0.0.1')}/messaging`, {
      path: '/api/v1/socket.io',
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    // `ready` is emitted after the server has joined the socket to its room,
    // so waiting for it rules out a race with the first emit.
    return new Promise((resolve, reject) => {
      socket.once('ready', () => resolve(socket));
      setTimeout(() => reject(new Error('socket never became ready')), 4_000);
    });
  }

  function nextEvent<T>(socket: Socket, event: string, ms = 2_000): Promise<T | null> {
    return new Promise((resolve) => {
      socket.once(event, (payload: T) => resolve(payload));
      setTimeout(() => resolve(null), ms);
    });
  }

  // ─── dispatch ↔ family ────────────────────────────────────────────────────

  describe('dispatch and a family, about one ride', () => {
    it('carries a conversation both ways, labelled for each side', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { family, rideId } = await assignedRide(op, driverId);

      const thread = await open(op.owner, { kind: 'dispatchFamily', rideId });
      expect(thread.myRole).toBe('dispatcher');
      expect(thread.title).toBe('Eleanor · family');
      expect(thread.ride?.patientName).toBe('Eleanor');

      await send(op.owner, thread.id, 'Your driver is running ten minutes late.');

      const familyInbox = await inbox(family);
      expect(familyInbox).toHaveLength(1);
      expect(familyInbox[0]).toMatchObject({
        id: thread.id,
        title: 'Meridian Transit Partners dispatch',
        myRole: 'family',
        unreadCount: 1,
        rideId,
      });

      const reply = await send(family, thread.id, 'Thank you, she will wait inside.');
      expect(reply.senderLabel).toBe('Sarah (daughter)');
      expect(reply.mine).toBe(true);

      const seenByDispatch = await messages(op.owner, thread.id);
      expect(seenByDispatch.map((m) => [m.senderLabel, m.mine])).toEqual([
        ['Dana · Dispatch', true],
        ['Sarah (daughter)', false],
      ]);
    });

    it('lets the family open the ride thread without knowing the operator', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { family, rideId } = await assignedRide(op, driverId);

      const fromFamily = await open(family, { kind: 'dispatchFamily', rideId });
      const fromDispatch = await open(op.owner, { kind: 'dispatchFamily', rideId });
      expect(fromFamily.id).toBe(fromDispatch.id);
    });

    it('is invisible to an unrelated family and to another operator', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { rideId } = await assignedRide(op, driverId);
      const thread = await open(op.owner, { kind: 'dispatchFamily', rideId });
      await send(op.owner, thread.id, 'Hello');

      const stranger = await registerUser(harness);
      const rival = await operator('Rival Rides');

      for (const outsider of [stranger, rival.owner]) {
        await messages(outsider, thread.id, 404);
        await send(outsider, thread.id, 'let me in', 404);
        expect(await inbox(outsider)).toHaveLength(0);
      }

      // Nor can another operator open a line to this family by naming the patient.
      await open(rival.owner, { kind: 'dispatchFamily', rideId }, 404);
    });

    it('drops a family member the moment their grant is revoked', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { family, patientId, rideId } = await assignedRide(op, driverId);
      const thread = await open(op.owner, { kind: 'dispatchFamily', rideId });
      await send(op.owner, thread.id, 'Hello');

      await harness.prisma.patientAccess.updateMany({
        where: { userId: family.userId, patientId },
        data: { revokedAt: new Date() },
      });

      await messages(family, thread.id, 404);
      expect(await inbox(family)).toHaveLength(0);
    });

    it('closes a finished trip to the family after the grace period, but not to dispatch', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { family, rideId } = await assignedRide(op, driverId);
      const thread = await open(op.owner, { kind: 'dispatchFamily', rideId });

      await advance(rideId, [
        'driverArrived',
        'passengerOnboard',
        'inProgress',
        'arrivedAtDestination',
        'completed',
      ]);
      // Wound back rather than waited for.
      await harness.prisma.rideStatusHistory.updateMany({
        where: { rideId, toStatus: 'completed' },
        data: { at: new Date(Date.now() - RIDE_THREAD_GRACE_MS - 60_000) },
      });

      await send(family, thread.id, 'Did she leave her glasses?', 409);
      expect((await messages(family, thread.id)).length).toBe(0);
      await send(op.owner, thread.id, 'We found a pair of glasses in the car.');
    });
  });

  // ─── idempotency and notifications ────────────────────────────────────────

  describe('delivery', () => {
    it('stores a retried message once', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { rideId } = await assignedRide(op, driverId);
      const thread = await open(op.owner, { kind: 'dispatchFamily', rideId });

      const clientMessageId = randomUUID();
      const first = await authed(harness, op.owner.accessToken)
        .post(`/api/v1/conversations/${thread.id}/messages`)
        .send({ body: 'On our way', clientMessageId })
        .expect(201);
      const second = await authed(harness, op.owner.accessToken)
        .post(`/api/v1/conversations/${thread.id}/messages`)
        .send({ body: 'On our way', clientMessageId })
        .expect(201);

      expect((second.body as Message).id).toBe((first.body as Message).id);
      expect(await harness.prisma.message.count()).toBe(1);
    });

    it('merges notifications per thread, routes them by app, and says nothing about content', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { family, rideId } = await assignedRide(op, driverId);
      const thread = await open(op.owner, { kind: 'dispatchFamily', rideId });

      await send(op.owner, thread.id, 'Eleanor, your driver Marcus is outside');
      await send(op.owner, thread.id, 'He is in a silver Sienna');

      const toFamily = await harness.prisma.notification.findMany({
        where: { userId: family.userId, kind: 'messageReceived' },
      });
      expect(toFamily).toHaveLength(1);
      expect(toFamily[0]).toMatchObject({
        appTarget: 'family',
        conversationId: thread.id,
        rideId,
      });

      // FOUNDATION §9: no names, no content.
      const text = `${toFamily[0]!.title} ${toFamily[0]!.body}`;
      for (const secret of ['Eleanor', 'Marcus', 'Sienna', 'outside', 'Meridian']) {
        expect(text).not.toContain(secret);
      }

      // Reading clears it, and the next message raises a fresh one.
      await authed(harness, family.accessToken)
        .post(`/api/v1/conversations/${thread.id}/read`)
        .expect(204);
      expect((await inbox(family))[0]!.unreadCount).toBe(0);

      await send(op.owner, thread.id, 'Arrived');
      expect(
        await harness.prisma.notification.count({
          where: { userId: family.userId, kind: 'messageReceived', readAt: null },
        }),
      ).toBe(1);

      // The reply reaches the console, not the dispatcher's family app.
      await send(family, thread.id, 'Thanks');
      const toDispatch = await harness.prisma.notification.findFirstOrThrow({
        where: { userId: op.owner.userId, kind: 'messageReceived' },
      });
      expect(toDispatch.appTarget).toBe('ops');

      // A dispatcher who also has a family grant would otherwise see the
      // console's alerts in the family app. Only family-targeted rows are listed.
      await harness.prisma.patientAccess.create({
        data: {
          userId: op.owner.userId,
          patientId: (
            await harness.prisma.ride.findUniqueOrThrow({ where: { id: rideId } })
          ).patientId,
          relationship: 'son',
          permissions: ['viewProfile'],
        },
      });
      const dispatcherState = await authed(harness, op.owner.accessToken)
        .get('/api/v1/care/state')
        .expect(200);
      const listed = (
        dispatcherState.body as { notifications: Array<{ kind: string }> }
      ).notifications;
      expect(listed.filter((n) => n.kind === 'messageReceived')).toHaveLength(0);
    });

    it('pushes new messages over the socket to members, and only to members', async () => {
      const op = await operator();
      const { driverId } = await driver(op, 'Marcus T.');
      const { family, rideId } = await assignedRide(op, driverId);
      const stranger = await registerUser(harness);
      const thread = await open(op.owner, { kind: 'dispatchFamily', rideId });

      const familySocket = await connect(family.accessToken);
      const strangerSocket = await connect(stranger.accessToken);
      const received = nextEvent<{ conversationId: string; message: Message }>(
        familySocket,
        'message.created',
      );
      const leaked = nextEvent(strangerSocket, 'message.created', 800);

      await send(op.owner, thread.id, 'Five minutes away');

      const event = await received;
      expect(event?.conversationId).toBe(thread.id);
      expect(event?.message).toMatchObject({ body: 'Five minutes away', mine: false });
      expect(event?.message).not.toHaveProperty('senderUserId');
      expect(await leaked).toBeNull();
    });
  });

  // ─── dispatch ↔ driver, and drivers together ──────────────────────────────

  describe('drivers', () => {
    it('gives a ride thread to the driver it is assigned to, and takes it away on reassignment', async () => {
      const op = await operator();
      const marcus = await driver(op, 'Marcus T.');
      const priya = await driver(op, 'Priya S.');
      const { rideId } = await assignedRide(op, marcus.driverId);

      const thread = await open(marcus.account, { kind: 'dispatchDriver', rideId });
      expect(thread.title).toBe('Meridian Transit Partners dispatch');
      await send(marcus.account, thread.id, 'Passenger needs help with the steps.');

      // Reassigned. Written directly: what is under test is that nothing
      // *else* has to change for Marcus to lose the thread.
      await harness.prisma.ride.update({
        where: { id: rideId },
        data: { driverId: priya.driverId },
      });

      await messages(marcus.account, thread.id, 404);
      await messages(op.owner, thread.id);
    });

    it("keeps a driver out of another driver's dispatch thread", async () => {
      const op = await operator();
      const marcus = await driver(op, 'Marcus T.');
      const priya = await driver(op, 'Priya S.');

      const thread = await open(marcus.account, { kind: 'dispatchDriver' });
      await send(marcus.account, thread.id, 'Starting my shift.');
      await messages(priya.account, thread.id, 404);
    });

    it('lets drivers message an on-shift colleague, and lets dispatch read but not write', async () => {
      const op = await operator();
      const marcus = await driver(op, 'Marcus T.');
      const priya = await driver(op, 'Priya S.');

      const colleagues = await authed(harness, marcus.account.accessToken)
        .get(`/api/v1/organizations/${op.organizationId}/colleagues`)
        .expect(200);
      expect(
        (colleagues.body as Array<{ displayName: string }>).map((c) => c.displayName),
      ).toEqual(['Priya S.']);

      const thread = await open(marcus.account, {
        kind: 'driverDriver',
        peerDriverId: priya.driverId,
      });
      await send(marcus.account, thread.id, 'Can you take my 3pm?');

      // Same thread from the other side.
      const fromPriya = await open(priya.account, {
        kind: 'driverDriver',
        peerDriverId: marcus.driverId,
      });
      expect(fromPriya.id).toBe(thread.id);

      // Dispatch oversees driver threads; it does not open them.
      await open(
        op.owner,
        {
          kind: 'driverDriver',
          organizationId: op.organizationId,
          driverId: marcus.driverId,
          peerDriverId: priya.driverId,
        },
        404,
      );

      const dispatchView = (await inbox(op.owner)).find((c) => c.id === thread.id);
      expect(dispatchView).toMatchObject({ myRole: 'dispatcher', canPost: false });
      await send(op.owner, thread.id, 'Dispatch here', 404);
    });

    it('refuses to open a thread with a colleague who is off shift', async () => {
      const op = await operator();
      const marcus = await driver(op, 'Marcus T.');
      const priya = await driver(op, 'Priya S.', { onShift: false });

      const response = await authed(harness, marcus.account.accessToken)
        .post('/api/v1/conversations')
        .send({ kind: 'driverDriver', peerDriverId: priya.driverId })
        .expect(409);
      expect((response.body as { error: { message: string } }).error.message).toMatch(
        /off shift/,
      );
    });

    it('does not let a driver reach a driver at another operator', async () => {
      const op = await operator();
      const rival = await operator('Rival Rides');
      const marcus = await driver(op, 'Marcus T.');
      const other = await driver(rival, 'Olu A.');

      await open(
        marcus.account,
        { kind: 'driverDriver', peerDriverId: other.driverId },
        404,
      );
      await authed(harness, marcus.account.accessToken)
        .get(`/api/v1/organizations/${rival.organizationId}/colleagues`)
        .expect(404);
    });

    it('runs a team channel for the operator', async () => {
      const op = await operator();
      const marcus = await driver(op, 'Marcus T.');
      const priya = await driver(op, 'Priya S.');

      const team = await open(op.owner, {
        kind: 'operatorDrivers',
        organizationId: op.organizationId,
      });
      await send(op.owner, team.id, 'Snow on the bridge — allow extra time.');

      for (const d of [marcus, priya]) {
        const [thread] = await inbox(d.account);
        expect(thread).toMatchObject({
          id: team.id,
          title: 'Meridian Transit Partners team',
          unreadCount: 1,
        });
      }
    });
  });

  // ─── retention ────────────────────────────────────────────────────────────

  describe('retention', () => {
    it('removes a thread a year after its last message, and an empty one after a week', async () => {
      const op = await operator();
      const marcus = await driver(op, 'Marcus T.');
      const stale = await open(marcus.account, { kind: 'dispatchDriver' });
      await send(marcus.account, stale.id, 'An old message');
      const team = await open(op.owner, {
        kind: 'operatorDrivers',
        organizationId: op.organizationId,
      });
      await send(op.owner, team.id, 'A recent message');

      const yearAgo = new Date(Date.now() - 366 * 24 * 3600 * 1000);
      await harness.prisma.conversation.update({
        where: { id: stale.id },
        data: { lastMessageAt: yearAgo },
      });
      const neverUsed = await harness.prisma.conversation.create({
        data: {
          kind: 'operatorDrivers',
          organizationId: op.organizationId,
          subjectKey: `unused-${op.organizationId}`,
          createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
        },
      });

      const results = await harness.app.get(RetentionService).run();
      expect(results['conversations']).toBe(2);

      const left = await harness.prisma.conversation.findMany({ select: { id: true } });
      expect(left.map((c) => c.id)).toEqual([team.id]);
      // Messages went with their thread.
      expect(
        await harness.prisma.message.count({ where: { conversationId: stale.id } }),
      ).toBe(0);
      expect(neverUsed.id).not.toBe(team.id);
    });
  });
});
