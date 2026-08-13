import { DateTime } from 'luxon';

/**
 * When each reminder for an appointment should fire.
 *
 * "Timezone-correct" here means something specific and narrow, and it is worth
 * stating because the obvious implementation is wrong in a way nobody notices
 * until March:
 *
 * A reminder offset is measured **from the appointment's local wall time**,
 * not from a UTC instant. "The day before" means the same clock time on the
 * previous local day. Across a daylight-saving boundary those are different
 * things — subtracting 1440 minutes from a UTC instant lands an hour early or
 * an hour late, and "your ride is tomorrow at 10:40" arriving at 05:00 is the
 * kind of bug that gets a product uninstalled by the exact user who needed it.
 *
 * Pure and clock-injected: `now` is a parameter, so every case below is
 * testable without waiting for October.
 */

export interface ScheduledReminder {
  offsetMinutes: number;
  /** Absolute UTC instant to fire at. */
  scheduledFor: Date;
}

export interface ReminderInput {
  /** The appointment start, in UTC. */
  startsAt: Date;
  /** IANA zone of the clinic, e.g. "America/New_York". */
  timeZone: string;
  /** Minutes before the appointment, e.g. [1440, 120]. */
  offsetMinutes: readonly number[];
  /** Reminders already in the past are not scheduled. */
  now: Date;
}

/**
 * A reminder closer than this to *now* is dropped rather than fired
 * immediately.
 *
 * A "your appointment is in two hours" notification that arrives ninety
 * seconds after the appointment was booked is noise, and it undermines the
 * one that matters.
 */
const MINIMUM_LEAD_MS = 60_000;

const MINUTES_PER_DAY = 1440;

export function scheduleReminders(input: ReminderInput): ScheduledReminder[] {
  const zone = normaliseZone(input.timeZone);

  const localStart = DateTime.fromJSDate(input.startsAt, { zone });
  if (!localStart.isValid) return [];

  const nowMs = input.now.getTime();

  return input.offsetMinutes
    .map((offsetMinutes) => {
      // The offset is split into whole local days and a remainder, and the two
      // halves are subtracted differently on purpose:
      //
      //   * **Days walk the calendar.** One day before 10:40 is 10:40 on the
      //     previous local day — 23 or 25 real hours across a DST boundary.
      //     This is what "the day before" means to the person reading it.
      //   * **The remainder is exact.** "Two hours before" means two hours of
      //     elapsed time, which is what someone planning to leave the house
      //     is counting.
      //
      // Subtracting the whole offset as minutes — the obvious implementation —
      // gets the first case wrong twice a year, and "your ride is tomorrow at
      // 10:40" arriving at 09:40 or 11:40 is exactly the kind of bug that gets
      // this product uninstalled by the user who needed it most.
      const days = Math.floor(offsetMinutes / MINUTES_PER_DAY);
      const minutes = offsetMinutes % MINUTES_PER_DAY;

      const fireAt = localStart.minus({ days }).minus({ minutes });
      return { offsetMinutes, scheduledFor: fireAt.toUTC().toJSDate() };
    })
    .filter((reminder) => reminder.scheduledFor.getTime() - nowMs >= MINIMUM_LEAD_MS)
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

/**
 * Falls back rather than throwing on an unknown zone.
 *
 * An appointment with a mistyped zone should still get reminders at
 * approximately the right time; refusing to schedule any would turn a data
 * problem into a missed appointment. The fallback is UTC, which is visibly
 * wrong in a way that gets reported, rather than a plausible-looking guess.
 */
export function normaliseZone(timeZone: string): string {
  return DateTime.local().setZone(timeZone).isValid ? timeZone : 'utc';
}

/** The wall time a person would read off a clinic letter. */
export function localWallTime(startsAt: Date, timeZone: string): string {
  return DateTime.fromJSDate(startsAt, { zone: normaliseZone(timeZone) }).toFormat(
    'yyyy-LL-dd HH:mm',
  );
}
