import { DateTime } from 'luxon';

import { localWallTime, normaliseZone, scheduleReminders } from './reminder-schedule';

const NY = 'America/New_York';

/** An appointment at a given local wall time, expressed as the UTC instant. */
function appointmentAt(local: string, zone = NY): Date {
  return DateTime.fromISO(local, { zone }).toUTC().toJSDate();
}

describe('reminder scheduling', () => {
  it('fires each offset before the appointment, earliest first', () => {
    const startsAt = appointmentAt('2026-09-17T10:40');
    const reminders = scheduleReminders({
      startsAt,
      timeZone: NY,
      offsetMinutes: [120, 1440],
      now: appointmentAt('2026-09-01T09:00'),
    });

    expect(reminders.map((r) => r.offsetMinutes)).toEqual([1440, 120]);
    expect(reminders[0]?.scheduledFor.getTime()).toBeLessThan(
      reminders[1]!.scheduledFor.getTime(),
    );
    expect(reminders[1]?.scheduledFor.getTime()).toBeLessThan(startsAt.getTime());
  });

  it('keeps the local wall time across a day boundary', () => {
    // "The day before" must mean the same clock time on the previous local
    // day, which is what a person actually expects.
    const [dayBefore] = scheduleReminders({
      startsAt: appointmentAt('2026-09-17T10:40'),
      timeZone: NY,
      offsetMinutes: [1440],
      now: appointmentAt('2026-09-01T09:00'),
    });

    expect(localWallTime(dayBefore!.scheduledFor, NY)).toBe('2026-09-16 10:40');
  });

  // ─── the reason this file exists ────────────────────────────────────────

  it('holds the wall time across the spring-forward boundary', () => {
    // US DST begins 2026-03-08. A "day before" reminder for an appointment on
    // the 8th must still read 10:40 on the 7th — even though only 23 hours
    // separate the two instants.
    const [reminder] = scheduleReminders({
      startsAt: appointmentAt('2026-03-08T10:40'),
      timeZone: NY,
      offsetMinutes: [1440],
      now: appointmentAt('2026-03-01T09:00'),
    });

    expect(localWallTime(reminder!.scheduledFor, NY)).toBe('2026-03-07 10:40');

    const gapHours =
      (appointmentAt('2026-03-08T10:40').getTime() - reminder!.scheduledFor.getTime()) /
      3_600_000;
    expect(gapHours).toBe(23);
  });

  it('holds the wall time across the autumn fall-back boundary', () => {
    // US DST ends 2026-11-01: twenty-five hours between the same wall times.
    const [reminder] = scheduleReminders({
      startsAt: appointmentAt('2026-11-01T10:40'),
      timeZone: NY,
      offsetMinutes: [1440],
      now: appointmentAt('2026-10-01T09:00'),
    });

    expect(localWallTime(reminder!.scheduledFor, NY)).toBe('2026-10-31 10:40');

    const gapHours =
      (appointmentAt('2026-11-01T10:40').getTime() - reminder!.scheduledFor.getTime()) /
      3_600_000;
    expect(gapHours).toBe(25);
  });

  it('splits a mixed offset into calendar days plus exact minutes', () => {
    // 1500 minutes is "a day and an hour before": the day walks the calendar,
    // the hour is elapsed time.
    const [reminder] = scheduleReminders({
      startsAt: appointmentAt('2026-09-17T10:40'),
      timeZone: NY,
      offsetMinutes: [1500],
      now: appointmentAt('2026-09-01T09:00'),
    });

    expect(localWallTime(reminder!.scheduledFor, NY)).toBe('2026-09-16 09:40');
  });

  it('is not fooled by a zone with a non-hour offset', () => {
    // Kolkata is UTC+05:30. A naive implementation that rounds to whole hours
    // is thirty minutes wrong here, every time.
    const zone = 'Asia/Kolkata';
    const [reminder] = scheduleReminders({
      startsAt: appointmentAt('2026-09-17T10:40', zone),
      timeZone: zone,
      offsetMinutes: [120],
      now: appointmentAt('2026-09-01T09:00', zone),
    });

    expect(localWallTime(reminder!.scheduledFor, zone)).toBe('2026-09-17 08:40');
  });

  // ─── things that must not be scheduled ──────────────────────────────────

  it('drops reminders that are already in the past', () => {
    // Booking something for this afternoon must not fire yesterday's reminder.
    const reminders = scheduleReminders({
      startsAt: appointmentAt('2026-09-17T10:40'),
      timeZone: NY,
      offsetMinutes: [1440, 120],
      now: appointmentAt('2026-09-17T09:00'),
    });

    expect(reminders.map((r) => r.offsetMinutes)).toEqual([]);
  });

  it('keeps an offset that is still comfortably ahead', () => {
    const reminders = scheduleReminders({
      startsAt: appointmentAt('2026-09-17T10:40'),
      timeZone: NY,
      offsetMinutes: [1440, 120],
      now: appointmentAt('2026-09-17T06:00'),
    });

    expect(reminders.map((r) => r.offsetMinutes)).toEqual([120]);
  });

  it('drops a reminder that would fire within a minute of being scheduled', () => {
    // "Your appointment is in two hours", ninety seconds after booking it, is
    // noise that undermines the reminder that matters.
    const reminders = scheduleReminders({
      startsAt: appointmentAt('2026-09-17T10:40'),
      timeZone: NY,
      offsetMinutes: [120],
      now: appointmentAt('2026-09-17T08:39:30'),
    });

    expect(reminders).toEqual([]);
  });

  it('returns nothing when no offsets are configured', () => {
    expect(
      scheduleReminders({
        startsAt: appointmentAt('2026-09-17T10:40'),
        timeZone: NY,
        offsetMinutes: [],
        now: appointmentAt('2026-09-01T09:00'),
      }),
    ).toEqual([]);
  });
});

describe('zone handling', () => {
  it('accepts a real IANA zone unchanged', () => {
    expect(normaliseZone(NY)).toBe(NY);
  });

  it('falls back to UTC on a mistyped zone rather than refusing to schedule', () => {
    // A data problem should not become a missed appointment — and UTC is
    // visibly wrong in a way that gets reported, unlike a plausible guess.
    expect(normaliseZone('America/New_Yrok')).toBe('utc');

    const reminders = scheduleReminders({
      startsAt: appointmentAt('2026-09-17T10:40'),
      timeZone: 'Nowhere/Nothing',
      offsetMinutes: [1440],
      now: appointmentAt('2026-09-01T09:00'),
    });
    expect(reminders).toHaveLength(1);
  });

  it('schedules nothing for an appointment whose start is not a real instant', () => {
    // A NaN Date reaches Luxon as an invalid DateTime, and every arithmetic
    // result from it is invalid too. Returning nothing is right: a reminder at
    // an invalid time would either never fire or fire immediately.
    const reminders = scheduleReminders({
      startsAt: new Date('not a date'),
      timeZone: 'America/New_York',
      offsetMinutes: [1440, 120],
      now: appointmentAt('2026-09-01T09:00'),
    });
    expect(reminders).toEqual([]);
  });
});
