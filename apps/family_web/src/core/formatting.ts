/**
 * Presentation-time formatting. Mirrors lib/core/formatting.dart, producing the
 * same strings as its `intl` patterns so the two apps read identically.
 */

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const weekday = (d: Date) => WEEKDAYS[d.getDay()]!;
const month = (d: Date) => MONTHS[d.getMonth()]!;

/** 'h:mm a' — "9:05 AM". */
export function formatTime(at: Date): string {
  return formatClock(at.getHours(), at.getMinutes());
}

export function formatClock(hours: number, minutes: number): string {
  const suffix = hours < 12 ? 'AM' : 'PM';
  const h = hours % 12 === 0 ? 12 : hours % 12;
  return `${h}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** 'EEEE d MMMM' — "Thursday 14 August". */
export const formatDay = (at: Date) => `${weekday(at)} ${at.getDate()} ${month(at)}`;

/** 'E d MMM' — "Thu 14 Aug". */
export const formatShortDay = (at: Date) =>
  `${weekday(at).slice(0, 3)} ${at.getDate()} ${month(at).slice(0, 3)}`;

/** yMMMd — "Aug 14, 2026". */
export const formatMediumDate = (at: Date) =>
  `${month(at).slice(0, 3)} ${at.getDate()}, ${at.getFullYear()}`;

/** yMMMMd — "August 14, 2026". */
export const formatLongDate = (at: Date) =>
  `${month(at)} ${at.getDate()}, ${at.getFullYear()}`;

/** "Thursday at 10:40 AM (clinic time)". */
export const formatAppointmentWhen = (at: Date, zoneLabel: string) =>
  `${weekday(at)} at ${formatTime(at)} (${zoneLabel})`;

/** Today / Tomorrow / Yesterday / Thursday / Thu 14 Aug. */
export function formatRelativeDay(at: Date, now: Date): string {
  // Whole calendar days between the two local dates, independent of DST.
  const target = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target - today) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return weekday(at);
  return formatShortDay(at);
}

/** "in 12 minutes", "in about 3 hours". */
export function formatCountdown(untilMs: number): string {
  if (untilMs < 0) return 'now';
  const minutes = Math.floor(untilMs / 60_000);
  if (minutes < 1) return 'in under a minute';
  if (minutes === 1) return 'in 1 minute';
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.floor(untilMs / 3_600_000);
  if (hours === 1) return 'in about an hour';
  if (hours < 24) return `in about ${hours} hours`;
  const days = Math.floor(untilMs / 86_400_000);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/**
 * Age of a piece of data. Used on every live-location surface: a stale
 * position shown as current manufactures false certainty, so the age is always
 * visible.
 */
export function formatFreshness(ageMs: number): string {
  const seconds = Math.trunc(ageMs / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.trunc(ageMs / 60_000);
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.trunc(ageMs / 3_600_000);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

/** "1 hr 20 min", "45 min". */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.trunc(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return hours === 1 ? '1 hr' : `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

/** Miles as Dart prints a double: "4.3", and "4.0" rather than "4". */
export const formatMiles = (miles: number) =>
  Number.isInteger(miles) ? miles.toFixed(1) : String(miles);

/** "(614) •••-••41" — for where the full number is not needed. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '•••';
  const last2 = digits.slice(-2);
  if (digits.length >= 10) return `(${digits.slice(0, 3)}) •••-••${last2}`;
  return `•••-${last2}`;
}

/** Coarse on purpose: "3 hours ago" is what a person checks a session list for. */
export function formatSessionAge(at: Date, now: Date = new Date()): string {
  const elapsedMin = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (elapsedMin < 2) return 'just now';
  if (elapsedMin < 60) return `${elapsedMin} minutes ago`;
  const hours = Math.floor(elapsedMin / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return `on ${formatMediumDate(at)}`;
}

/** Grouped in fours because a secret key is transcribed by hand. */
export const groupInFours = (secret: string) =>
  secret.match(/.{1,4}/g)?.join(' ') ?? '';

// ─── <input type="date|time"> plumbing ───────────────────────────────────────

/** "2026-08-14", in local time. */
export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "09:05", in local time. */
export const toTimeInput = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Local date + local time → a Date, or null if either is missing or malformed. */
export function combineLocal(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return new Date(+d[1]!, +d[2]! - 1, +d[3]!, +t[1]!, +t[2]!);
}

/** "09:05" → "9:05 AM". */
export function timeInputLabel(time: string): string {
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  return t ? formatClock(+t[1]!, +t[2]!) : time;
}
