/**
 * Dates, in the browser's locale and time zone — `DateFormat(...).format(x.toLocal())`
 * in the Flutter console.
 */

const two = (n: number) => String(n).padStart(2, '0');
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "14:05" — `DateFormat('HH:mm')`. 24-hour, because a queue is scanned by time. */
export const formatClock = (at: Date) =>
  `${two(at.getHours())}:${two(at.getMinutes())}`;

/** "3 Mar 2026" — `DateFormat('d MMM y')`. */
export const formatDay = (at: Date) =>
  `${at.getDate()} ${months[at.getMonth()]} ${at.getFullYear()}`;

/** "3 Mar 2026, 14:05" — `DateFormat('d MMM y, HH:mm')`. */
export const formatDayTime = (at: Date) => `${formatDay(at)}, ${formatClock(at)}`;

/** "3 Mar 2026, 14:05:09" — `DateFormat('d MMM y, HH:mm:ss')`, for the audit log. */
export const formatDayTimeSeconds = (at: Date) =>
  `${formatDayTime(at)}:${two(at.getSeconds())}`;

/** "vehicleInsurance" → "Vehicle insurance". */
export function documentLabel(kind: string): string {
  switch (kind) {
    case 'driversLicence':
      return 'Driving licence';
    case 'vehicleInsurance':
      return 'Vehicle insurance';
    case 'vehicleRegistration':
      return 'Vehicle registration';
    case 'backgroundCheck':
      return 'Background check';
    default:
      return kind;
  }
}

/** A plural where the Flutter console wrote "driver(s)". */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
