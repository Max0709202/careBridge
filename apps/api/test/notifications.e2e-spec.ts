import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  registerUser,
  verifyEmail,
} from './support/factories';
import { NotificationDispatchService } from '../src/modules/care/notification-dispatch.service';

/**
 * Notification delivery, and the two rules that constrain it.
 *
 * The contentless rule (FOUNDATION §9) is not a style preference. A phone on a
 * kitchen table is readable by whoever is in the room, and for an older adult
 * that may include the person they most need privacy from. It is asserted here
 * against real notification bodies rather than against a template, because a
 * template is not what reaches the phone.
 */
describe('notifications', () => {
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

  async function familyWithAppointment() {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);
    const patientId = await createPatient(harness, user.accessToken, {
      preferredName: 'Margaret',
    });
    const clinicId = await createClinic(harness, user.accessToken, {
      name: 'Kings County Cardiology',
    });
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
    });
    return { user, patientId, clinicId, appointmentId };
  }

  // ─── the contentless rule ───────────────────────────────────────────────

  it('puts no patient name, clinic name, address or time in any notification', async () => {
    const { user } = await familyWithAppointment();

    const notifications = await harness.prisma.notification.findMany({
      where: { userId: user.userId },
    });

    expect(notifications.length).toBeGreaterThan(0);

    const text = notifications.map((n) => `${n.title} ${n.body}`).join(' ');
    expect(text).not.toContain('Margaret');
    expect(text).not.toContain('Kings County');
    expect(text).not.toMatch(/Clarkson|Brooklyn|11203/);
    // No times either: "10:40" on a lock screen says as much as a clinic name.
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('tells the whole care circle, not just whoever acted', async () => {
    // A daughter booking a ride and a son watching for it is the normal case.
    // Telling only the person who tapped the button leaves the rest of the
    // family in exactly the silence this product exists to remove.
    const { user, patientId } = await familyWithAppointment();

    const sibling = await registerUser(harness);
    await verifyEmail(harness, sibling.userId);
    await harness.prisma.patientAccess.create({
      data: {
        userId: sibling.userId,
        patientId,
        relationship: 'son',
        permissions: ['viewProfile', 'scheduleAppointments'],
        grantedByUserId: user.userId,
      },
    });

    await authed(harness, user.accessToken)
      .post('/api/v1/appointments')
      .send({
        patientId,
        clinicId: await createClinic(harness, user.accessToken, {
          name: 'Second Clinic',
        }),
        startsAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
        expectedDurationMinutes: 30,
        type: 'followUp',
      })
      .expect(201);

    const theirs = await harness.prisma.notification.findMany({
      where: { userId: sibling.userId },
    });
    expect(theirs.length).toBeGreaterThan(0);
  });

  it('does not notify someone whose access has been revoked', async () => {
    const { user, patientId } = await familyWithAppointment();

    const formerRelative = await registerUser(harness);
    await harness.prisma.patientAccess.create({
      data: {
        userId: formerRelative.userId,
        patientId,
        relationship: 'friend',
        permissions: ['viewProfile'],
        grantedByUserId: user.userId,
        revokedAt: new Date(),
      },
    });

    await authed(harness, user.accessToken)
      .post(
        `/api/v1/appointments/${(await familyWithAppointment()).appointmentId}/cancel`,
      )
      .send({ reason: 'no longer needed' })
      .catch(() => undefined);

    const theirs = await harness.prisma.notification.findMany({
      where: { userId: formerRelative.userId },
    });
    expect(theirs).toEqual([]);
  });

  // ─── per-channel preferences ────────────────────────────────────────────

  it('returns the full matrix, defaults merged with the user’s changes', async () => {
    // Complete rather than "the overrides", so the client never holds a second
    // copy of the policy that is free to drift from the server's.
    const user = await registerUser(harness);

    const response = await authed(harness, user.accessToken)
      .get('/api/v1/notifications/preferences')
      .expect(200);

    const rows = response.body as Array<{
      kind: string;
      channel: string;
      enabled: boolean;
      configurable: boolean;
    }>;

    // 15 kinds × 3 channels.
    expect(rows).toHaveLength(45);
    expect(
      rows.filter((r) => r.channel === 'inApp').every((r) => !r.configurable),
    ).toBe(true);
  });

  it('refuses to switch in-app notifications off', async () => {
    // The centre inside the app is the record of what happened. A user who
    // could switch it off would have a timeline that lies by omission — and
    // the timeline is what disputes are resolved with.
    const user = await registerUser(harness);

    const response = await authed(harness, user.accessToken)
      .put('/api/v1/notifications/preferences')
      .send({ kind: 'rideCompleted', channel: 'inApp', enabled: false })
      .expect(400);

    // Refused at the DTO, before the service is reached. Both layers hold the
    // rule: the DTO because it is the cheapest place to say no, the service
    // because the DTO is not the only caller it will ever have.
    expect(errorOf(response).message).toMatch(/only email and push/i);
  });

  it('stores an override only when it differs from the default', async () => {
    // Keeping the table sparse is what lets a *changed* default apply to
    // everyone who never expressed an opinion — otherwise a new notification
    // kind ships switched off for every existing user.
    const user = await registerUser(harness);

    await authed(harness, user.accessToken)
      .put('/api/v1/notifications/preferences')
      .send({ kind: 'driverAssigned', channel: 'email', enabled: false })
      .expect(200);

    expect(
      await harness.prisma.notificationPreference.count({
        where: { userId: user.userId },
      }),
    ).toBe(1);

    await authed(harness, user.accessToken)
      .put('/api/v1/notifications/preferences')
      .send({ kind: 'driverAssigned', channel: 'email', enabled: true })
      .expect(200);

    expect(
      await harness.prisma.notificationPreference.count({
        where: { userId: user.userId },
      }),
    ).toBe(0);
  });

  // ─── delivery ───────────────────────────────────────────────────────────

  it('records an outcome on every channel, including suppression', async () => {
    // `suppressed` is a first-class result and not a failure: a user who
    // turned email off did not have a delivery problem.
    const { user } = await familyWithAppointment();
    const dispatch = harness.app.get(NotificationDispatchService);

    const swept = await dispatch.sweep();
    expect(swept).toBeGreaterThan(0);

    const notification = await harness.prisma.notification.findFirstOrThrow({
      where: { userId: user.userId },
    });
    await dispatch.deliver(notification.id);

    const deliveries = await harness.prisma.notificationDelivery.findMany({
      where: { notificationId: notification.id },
    });

    expect(deliveries.map((d) => d.channel).sort()).toEqual(['email', 'inApp', 'push']);
    expect(deliveries.find((d) => d.channel === 'inApp')?.status).toBe('sent');
    // appointmentCreated defaults push off — quiet by design.
    expect(deliveries.find((d) => d.channel === 'push')?.status).toBe('suppressed');
  });

  it('does not record a push as sent when there is no device to send to', async () => {
    // "Why did I not get a push?" answered by a row saying we delivered one
    // costs somebody an hour before they think to check whether the account
    // ever registered a device.
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);

    // driverAssigned defaults push on, so the channel is genuinely attempted.
    const patientId = await createPatient(harness, user.accessToken);
    await harness.prisma.notification.create({
      data: {
        userId: user.userId,
        kind: 'driverAssigned',
        title: 'A driver is on the way',
        body: 'Open CareBridge for the details.',
      },
    });

    const dispatch = harness.app.get(NotificationDispatchService);
    const notification = await harness.prisma.notification.findFirstOrThrow({
      where: { userId: user.userId, kind: 'driverAssigned' },
    });
    await dispatch.deliver(notification.id);

    const push = await harness.prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: 'push' },
    });

    expect(push.status).toBe('suppressed');
    expect(push.failureReason).toMatch(/no registered device/i);
    expect(patientId).toBeDefined();
  });

  it('records a push as sent once a device is registered', async () => {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);

    await authed(harness, user.accessToken)
      .post('/api/v1/me/devices')
      .send({ token: 'fcm-a-real-looking-token', platform: 'android' })
      .expect(201);

    await harness.prisma.notification.create({
      data: {
        userId: user.userId,
        kind: 'driverAssigned',
        title: 'A driver is on the way',
        body: 'Open CareBridge for the details.',
      },
    });

    const dispatch = harness.app.get(NotificationDispatchService);
    const notification = await harness.prisma.notification.findFirstOrThrow({
      where: { userId: user.userId, kind: 'driverAssigned' },
    });
    await dispatch.deliver(notification.id);

    const push = await harness.prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: 'push' },
    });
    expect(push.status).toBe('sent');
    expect(push.providerRef).toBe('1 device(s)');
  });

  it('suppresses a channel the user turned off', async () => {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);

    await authed(harness, user.accessToken)
      .put('/api/v1/notifications/preferences')
      .send({ kind: 'appointmentCreated', channel: 'email', enabled: false })
      .expect(200);

    const patientId = await createPatient(harness, user.accessToken);
    const clinicId = await createClinic(harness, user.accessToken);
    await createAppointment(harness, user.accessToken, { patientId, clinicId });

    const dispatch = harness.app.get(NotificationDispatchService);
    const notification = await harness.prisma.notification.findFirstOrThrow({
      where: { userId: user.userId, kind: 'appointmentCreated' },
    });
    await dispatch.deliver(notification.id);

    const email = await harness.prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: notification.id, channel: 'email' },
    });
    expect(email.status).toBe('suppressed');
  });

  it('sends a notification email that still says nothing', async () => {
    // The subject line is rendered in a banner on a locked phone.
    const { user } = await familyWithAppointment();
    harness.mail.clear();

    const dispatch = harness.app.get(NotificationDispatchService);
    const notification = await harness.prisma.notification.findFirstOrThrow({
      where: { userId: user.userId },
    });
    await dispatch.deliver(notification.id);

    const message = harness.mail.lastTo(user.email);
    expect(message?.subject).toBe('There is an update in CareBridge');
    expect(message?.text).not.toContain('Margaret');
    expect(message?.text).not.toContain('Kings County');
  });

  it('is idempotent: delivering twice does not double the delivery rows', async () => {
    const { user } = await familyWithAppointment();
    const dispatch = harness.app.get(NotificationDispatchService);

    const notification = await harness.prisma.notification.findFirstOrThrow({
      where: { userId: user.userId },
    });

    await dispatch.deliver(notification.id);
    await dispatch.deliver(notification.id);

    expect(
      await harness.prisma.notificationDelivery.count({
        where: { notificationId: notification.id },
      }),
    ).toBe(3);
  });

  // ─── device tokens ──────────────────────────────────────────────────────

  it('re-points a registration token at whoever registers it now', async () => {
    // FCM reassigns a token when a device is handed on or reinstalled. Two
    // rows would leave the previous owner attached to a live token, and their
    // next notification would arrive on a stranger's phone.
    const first = await registerUser(harness);
    const second = await registerUser(harness);
    const token = 'fcm-token-shared-between-two-owners';

    await authed(harness, first.accessToken)
      .post('/api/v1/me/devices')
      .send({ token, platform: 'android' })
      .expect(201);

    await authed(harness, second.accessToken)
      .post('/api/v1/me/devices')
      .send({ token, platform: 'android' })
      .expect(201);

    const rows = await harness.prisma.deviceToken.findMany({ where: { token } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(second.userId);
  });

  it('never returns the registration token in the device list', async () => {
    // It is a device identifier and a capability to push to that device; the
    // list only needs to be recognisable.
    const user = await registerUser(harness);
    const token = 'fcm-token-should-not-come-back';

    await authed(harness, user.accessToken)
      .post('/api/v1/me/devices')
      .send({ token, platform: 'ios' })
      .expect(201);

    const listed = await authed(harness, user.accessToken)
      .get('/api/v1/me/devices')
      .expect(200);

    expect(JSON.stringify(listed.body)).not.toContain(token);
  });

  it('will not let one account revoke another account’s device', async () => {
    const owner = await registerUser(harness);
    const attacker = await registerUser(harness);

    const created = await authed(harness, owner.accessToken)
      .post('/api/v1/me/devices')
      .send({ token: 'fcm-owned-token', platform: 'web' })
      .expect(201);

    const deviceId = (created.body as { id: string }).id;

    await authed(harness, attacker.accessToken)
      .delete(`/api/v1/me/devices/${deviceId}`)
      .expect(404);

    const stored = await harness.prisma.deviceToken.findUniqueOrThrow({
      where: { id: deviceId },
    });
    expect(stored.revokedAt).toBeNull();
  });
});
