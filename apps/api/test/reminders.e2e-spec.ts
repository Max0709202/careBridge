import { DateTime } from 'luxon';

import { TestHarness } from './support/harness';
import {
  authed,
  createAppointment,
  createClinic,
  createPatient,
  registerUser,
  verifyEmail,
} from './support/factories';
import { RemindersService } from '../src/modules/care/reminders.service';
import { QUEUE, type QueuePort } from '../src/infrastructure/queue/queue.port';

/**
 * Appointment reminders, against a real database.
 *
 * The unit tests in `src/domain/reminder-schedule.spec.ts` prove the arithmetic
 * — including both daylight-saving boundaries. These prove the part the
 * arithmetic cannot: that the rows are written in the same transaction as the
 * appointment, that a reschedule cancels the old ones, and that the *database*
 * is the record of intent so a lost queue does not silently cancel every
 * reminder in the system.
 */
describe('appointment reminders', () => {
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

  async function family() {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);
    const patientId = await createPatient(harness, user.accessToken);
    const clinicId = await createClinic(harness, user.accessToken, {
      timeZone: 'America/New_York',
    });
    return { user, patientId, clinicId };
  }

  const inDays = (days: number) =>
    DateTime.fromJSDate(new Date(), { zone: 'America/New_York' })
      .plus({ days })
      .set({ hour: 10, minute: 40, second: 0, millisecond: 0 })
      .toUTC()
      .toJSDate();

  it('writes a reminder row per configured offset', async () => {
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    const reminders = await harness.prisma.appointmentReminder.findMany({
      where: { appointmentId },
      orderBy: { offsetMinutes: 'desc' },
    });

    // The default offsets: a day before and two hours before.
    expect(reminders.map((r) => r.offsetMinutes)).toEqual([1440, 120]);
    expect(reminders.every((r) => r.sentAt === null)).toBe(true);
    expect(reminders.every((r) => r.cancelledAt === null)).toBe(true);
  });

  it('measures the offset against the clinic’s local wall time', async () => {
    // Not the server's zone and not the requester's: the appointment happens
    // where the clinic is.
    const { user, patientId } = await family();
    const clinicId = await createClinic(harness, user.accessToken, {
      name: 'West Coast Clinic',
      timeZone: 'America/Los_Angeles',
    });

    const startsAt = DateTime.fromISO('2027-06-10T10:40', {
      zone: 'America/Los_Angeles',
    })
      .toUTC()
      .toJSDate();

    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt,
    });

    const dayBefore = await harness.prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId, offsetMinutes: 1440 },
    });

    const local = DateTime.fromJSDate(dayBefore.scheduledFor, {
      zone: 'America/Los_Angeles',
    });
    expect(local.toFormat('yyyy-LL-dd HH:mm')).toBe('2027-06-09 10:40');
  });

  it('stores the clinic’s zone on the appointment', async () => {
    const { user, patientId } = await family();
    const clinicId = await createClinic(harness, user.accessToken, {
      name: 'Chicago Clinic',
      timeZone: 'America/Chicago',
    });
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(5),
    });

    const appointment = await harness.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });
    expect(appointment.timeZone).toBe('America/Chicago');
  });

  it('does not schedule a reminder that is already in the past', async () => {
    // Booking something for this afternoon must not fire yesterday's reminder.
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    const reminders = await harness.prisma.appointmentReminder.findMany({
      where: { appointmentId, cancelledAt: null },
    });
    expect(reminders.map((r) => r.offsetMinutes)).toEqual([120]);
  });

  it('cancels the old reminders and writes new ones on a reschedule', async () => {
    // A car turning up at the old time is bad; a reminder for the old time is
    // how a family ends up expecting it.
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    const before = await harness.prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId, offsetMinutes: 1440 },
    });

    const movedTo = inDays(9);
    await authed(harness, user.accessToken)
      .post(`/api/v1/appointments/${appointmentId}/reschedule`)
      .send({ startsAt: movedTo.toISOString() })
      .expect(201);

    const after = await harness.prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId, offsetMinutes: 1440 },
    });

    expect(after.scheduledFor.getTime()).toBeGreaterThan(before.scheduledFor.getTime());
    expect(after.cancelledAt).toBeNull();
    expect(after.sentAt).toBeNull();

    // The unique constraint on (appointment, offset) is what keeps this
    // idempotent: a reschedule replaces rather than accumulating.
    const all = await harness.prisma.appointmentReminder.findMany({
      where: { appointmentId },
    });
    expect(all).toHaveLength(2);
  });

  it('cancels the reminders when the appointment is cancelled', async () => {
    // "Your appointment is tomorrow" for something already called off is worse
    // than silence.
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    await authed(harness, user.accessToken)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .send({ reason: 'The clinic moved it' })
      .expect(201);

    const reminders = await harness.prisma.appointmentReminder.findMany({
      where: { appointmentId },
    });
    expect(reminders.every((r) => r.cancelledAt !== null)).toBe(true);
  });

  // ─── the database is the record of intent ───────────────────────────────

  it('re-arms every pending reminder from the database at boot', async () => {
    // Redis is a cache and may be lost. If the queue were the only record, a
    // flush would silently cancel every reminder in the system and nobody
    // would find out until a patient missed an appointment.
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    // Simulate the timers being lost while the rows survive.
    await harness.prisma.appointmentReminder.updateMany({
      where: { appointmentId },
      data: { jobId: null },
    });

    const reminders = harness.app.get(RemindersService);
    await reminders.rehydrate();

    const rearmed = await harness.prisma.appointmentReminder.findMany({
      where: { appointmentId },
    });
    expect(rearmed.every((r) => r.jobId !== null)).toBe(true);
  });

  it('derives the job id from the row, so re-arming cannot double-schedule', async () => {
    // This is the property that makes `enqueuePending` safe to call from
    // anywhere — after a commit, at boot, or twice by two instances racing.
    // BullMQ collapses a duplicate job id; the in-process adapter is written
    // to match, so the two are actually interchangeable rather than merely
    // similar.
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    const reminders = harness.app.get(RemindersService);
    await reminders.enqueuePending(appointmentId);
    await reminders.enqueuePending(appointmentId);

    const rows = await harness.prisma.appointmentReminder.findMany({
      where: { appointmentId },
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.jobId).toBe(`reminder:${row.id}`);
    }
  });

  it('reports which scheduler is live, and behaves the same either way', async () => {
    // The suite runs green against both adapters. Asserting the driver here
    // means a run cannot silently fall back to the in-process one and be
    // mistaken for a passing test of the BullMQ path.
    const queue = harness.app.get<QueuePort>(QUEUE);

    expect(queue.driver).toBe(process.env['REDIS_URL'] ? 'bullmq' : 'in-process');
  });

  it('fires a contentless reminder to the whole circle', async () => {
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    const reminder = await harness.prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId, offsetMinutes: 120 },
    });

    const reminders = harness.app.get(RemindersService);
    await reminders.fire(reminder.id);

    const sent = await harness.prisma.notification.findMany({
      where: { userId: user.userId, kind: 'appointmentReminder' },
    });

    expect(sent).toHaveLength(1);
    const text = `${sent[0]!.title} ${sent[0]!.body}`;
    expect(text).not.toContain('Margaret');
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('will not fire the same reminder twice', async () => {
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    const reminder = await harness.prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId, offsetMinutes: 120 },
    });

    const reminders = harness.app.get(RemindersService);
    await reminders.fire(reminder.id);
    await reminders.fire(reminder.id);

    expect(
      await harness.prisma.notification.count({
        where: { userId: user.userId, kind: 'appointmentReminder' },
      }),
    ).toBe(1);
  });

  it('does not fire a reminder for an appointment that has been cancelled', async () => {
    // The worker re-reads the row rather than trusting the job payload,
    // because a timer has no way to know the appointment was called off.
    const { user, patientId, clinicId } = await family();
    const appointmentId = await createAppointment(harness, user.accessToken, {
      patientId,
      clinicId,
      startsAt: inDays(7),
    });

    const reminder = await harness.prisma.appointmentReminder.findFirstOrThrow({
      where: { appointmentId, offsetMinutes: 120 },
    });

    // Cancel the appointment but leave the reminder row armed, which is the
    // state a lost cancellation would produce.
    await harness.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'canceled' },
    });
    await harness.prisma.appointmentReminder.update({
      where: { id: reminder.id },
      data: { cancelledAt: null },
    });

    const reminders = harness.app.get(RemindersService);
    await reminders.fire(reminder.id);

    expect(
      await harness.prisma.notification.count({
        where: { userId: user.userId, kind: 'appointmentReminder' },
      }),
    ).toBe(0);
  });
});
