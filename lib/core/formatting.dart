/// Presentation-time formatting.
///
/// Appointment times are always rendered in the *clinic's* zone with the zone
/// named, never silently converted to the viewer's local zone — a daughter in
/// Seattle booking for a mother in Ohio must never see a time that is three
/// hours wrong.
library;

import 'package:intl/intl.dart';

final _timeFormat = DateFormat('h:mm a');
final _weekdayFormat = DateFormat('EEEE');
final _dayFormat = DateFormat('EEEE d MMMM');
final _shortDayFormat = DateFormat('E d MMM');

String formatTime(DateTime at) => _timeFormat.format(at);

String formatDay(DateTime at) => _dayFormat.format(at);

String formatShortDay(DateTime at) => _shortDayFormat.format(at);

/// "Thursday at 10:40 AM (clinic time)"
String formatAppointmentWhen(DateTime at, String zoneLabel) =>
    '${_weekdayFormat.format(at)} at ${_timeFormat.format(at)} ($zoneLabel)';

/// Calendar-relative day label: Today / Tomorrow / Thursday / Thu 14 Aug.
String formatRelativeDay(DateTime at, DateTime now) {
  final target = DateTime(at.year, at.month, at.day);
  final today = DateTime(now.year, now.month, now.day);
  final days = target.difference(today).inDays;

  if (days == 0) return 'Today';
  if (days == 1) return 'Tomorrow';
  if (days == -1) return 'Yesterday';
  if (days > 1 && days < 7) return _weekdayFormat.format(at);
  return _shortDayFormat.format(at);
}

/// How long until something happens: "in 12 minutes", "in about 3 hours".
String formatCountdown(Duration until) {
  if (until.isNegative) return 'now';
  final minutes = until.inMinutes;
  if (minutes < 1) return 'in under a minute';
  if (minutes == 1) return 'in 1 minute';
  if (minutes < 60) return 'in $minutes minutes';
  final hours = until.inHours;
  if (hours == 1) return 'in about an hour';
  if (hours < 24) return 'in about $hours hours';
  final days = until.inDays;
  return days == 1 ? 'tomorrow' : 'in $days days';
}

/// Age of a piece of data: "just now", "45 seconds ago", "4 minutes ago".
///
/// Used on every live-location surface. Rendering a stale position as though it
/// were current manufactures false certainty about where a vulnerable person is,
/// which is worse than showing nothing — so the age is always visible.
String formatFreshness(Duration age) {
  final seconds = age.inSeconds;
  if (seconds < 5) return 'just now';
  if (seconds < 60) return '$seconds seconds ago';
  final minutes = age.inMinutes;
  if (minutes == 1) return '1 minute ago';
  if (minutes < 60) return '$minutes minutes ago';
  final hours = age.inHours;
  return hours == 1 ? '1 hour ago' : '$hours hours ago';
}

/// "1 hr 20 min", "45 min"
String formatDuration(Duration duration) {
  final hours = duration.inHours;
  final minutes = duration.inMinutes.remainder(60);
  if (hours == 0) return '$minutes min';
  if (minutes == 0) return hours == 1 ? '1 hr' : '$hours hr';
  return '$hours hr $minutes min';
}

/// Masks a phone number for display where the full number is not needed:
/// "(614) •••-••41".
String maskPhone(String phone) {
  final digits = phone.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 4) return '•••';
  final last2 = digits.substring(digits.length - 2);
  if (digits.length >= 10) {
    return '(${digits.substring(0, 3)}) •••-••$last2';
  }
  return '•••-$last2';
}
