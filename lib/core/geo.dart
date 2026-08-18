import 'dart:math' as math;

import '../domain/models.dart';

/// Great-circle distance in miles.
///
/// Straight-line distance is *not* road distance. Everything derived from it —
/// duration, fare — is therefore an estimate, and the UI must say so rather than
/// present a to-the-minute promise. A routing provider replaces this in Stage 3;
/// the [detourFactor] is a crude stand-in for the fact that roads bend.
double distanceMiles(
  Coordinates a,
  Coordinates b, {
  double detourFactor = 1.3,
}) {
  const earthRadiusMiles = 3958.8;
  final dLat = _radians(b.latitude - a.latitude);
  final dLon = _radians(b.longitude - a.longitude);
  final lat1 = _radians(a.latitude);
  final lat2 = _radians(b.latitude);

  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.pow(math.sin(dLon / 2), 2) * math.cos(lat1) * math.cos(lat2);
  final c = 2 * math.asin(math.min(1.0, math.sqrt(h)));

  return earthRadiusMiles * c * detourFactor;
}

/// Rough drive time. Deliberately conservative: an estimate that runs early
/// costs a family nothing, one that runs late costs them an appointment.
int estimateDriveMinutes(double miles, {double averageMph = 24}) {
  if (miles <= 0) return 0;
  const boardingBufferMinutes = 6;
  return (miles / averageMph * 60).ceil() + boardingBufferMinutes;
}

double _radians(double degrees) => degrees * math.pi / 180.0;
