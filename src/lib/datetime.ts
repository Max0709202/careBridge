import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Time handling policy for CareBridge.
 *
 * A ride to a clinic is anchored to a wall-clock time in a specific place. The
 * family member booking it may be in a different time zone from the senior,
 * and the operations scheduler may be in a third. So:
 *
 *   - Every timestamp is STORED in UTC (`timestamptz`).
 *   - Every service request also stores its own IANA time-zone name.
 *   - Every DISPLAY of an appointment time is rendered in the service
 *     location's zone, and labelled with that zone.
 *
 * Never format an appointment time with the viewer's local zone. Showing a
 * caregiver "9:00 AM" in their own zone when the senior's appointment is
 * 9:00 AM two zones away is exactly the kind of error that makes someone miss
 * a doctor.
 */

/** Zones offered in the MVP. US-only to start; the model is not US-specific. */
export const SUPPORTED_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export type SupportedTimeZone = (typeof SUPPORTED_TIME_ZONES)[number];

export function isSupportedTimeZone(value: string): value is SupportedTimeZone {
  return (SUPPORTED_TIME_ZONES as readonly string[]).includes(value);
}

/**
 * Validates any IANA zone name against the runtime's own tz database, so the
 * internal model stays extensible beyond the curated US list above.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a local wall-clock date and time in `timeZone` into the UTC instant
 * to persist. `date` is `YYYY-MM-DD`, `time` is `HH:mm` (24-hour).
 *
 * Returns null when the input does not describe a real instant, which happens
 * for times skipped by a daylight-saving spring-forward transition.
 */
export function wallClockToUtc(date: string, time: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch || !isValidTimeZone(timeZone)) return null;

  const [, year, month, day] = match.map(Number) as [unknown, number, number, number];
  const [, hour, minute] = timeMatch.map(Number) as [unknown, number, number];

  const zoned = new TZDate(year, month - 1, day, hour, minute, 0, 0, timeZone);
  const instant = new Date(zoned.getTime());
  if (Number.isNaN(instant.getTime())) return null;

  // Round-trip check: if the wall clock we get back differs, the requested
  // local time does not exist in that zone (DST gap).
  const roundTrip = new TZDate(instant, timeZone);
  if (roundTrip.getHours() !== hour || roundTrip.getMinutes() !== minute) return null;

  return instant;
}

/** Formats a stored UTC instant for display in the service location's zone. */
export function formatInTimeZone(instant: Date, timeZone: string, pattern: string): string {
  return format(new TZDate(instant, timeZone), pattern);
}

/** e.g. "Tue, Mar 4, 2025 at 9:00 AM (EST)" */
export function formatAppointmentTime(instant: Date, timeZone: string): string {
  const base = formatInTimeZone(instant, timeZone, "EEE, MMM d, yyyy 'at' h:mm a");
  return `${base} (${shortTimeZoneName(instant, timeZone)})`;
}

/** The zone's short name at that instant, e.g. "EST" vs "EDT". */
export function shortTimeZoneName(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(instant);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}
