/** Mirrors lib/core/geo.dart. */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Great-circle distance in miles.
 *
 * Straight-line distance is *not* road distance. Everything derived from it —
 * duration, fare — is therefore an estimate, and the UI must say so rather than
 * present a to-the-minute promise. A routing provider replaces this in Stage 3;
 * `detourFactor` is a crude stand-in for the fact that roads bend.
 */
export function distanceMiles(
  a: Coordinates,
  b: Coordinates,
  detourFactor = 1.3,
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  return earthRadiusMiles * c * detourFactor;
}

/**
 * City driving, averaged over lights, turns and the sort of traffic a medical
 * appointment is scheduled around. Named because two things use it — the fare
 * estimate and the fallback ETA — and a second copy would let them disagree
 * about how long the same journey takes.
 */
export const AVERAGE_CITY_MPH = 24;

/**
 * Rough drive time. Deliberately conservative: an estimate that runs early
 * costs a family nothing, one that runs late costs them an appointment.
 */
export function estimateDriveMinutes(
  miles: number,
  averageMph = AVERAGE_CITY_MPH,
): number {
  if (miles <= 0) return 0;
  const boardingBufferMinutes = 6;
  return Math.ceil((miles / averageMph) * 60) + boardingBufferMinutes;
}

/** Linear interpolation between two points, for the preview trip runner. */
export function lerp(a: Coordinates, b: Coordinates, t: number): Coordinates {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
