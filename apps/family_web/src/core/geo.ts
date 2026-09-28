import type { Coordinates } from '../domain/models';

/**
 * Great-circle distance in miles. Straight-line distance is not road distance,
 * so everything derived from it is an estimate; `detourFactor` is a crude
 * stand-in for roads bending. Mirrors lib/core/geo.dart.
 */
export function distanceMiles(a: Coordinates, b: Coordinates, detourFactor = 1.3): number {
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
 * Rough drive time, deliberately conservative: an estimate that runs early
 * costs a family nothing, one that runs late costs them an appointment.
 */
export function estimateDriveMinutes(miles: number, averageMph = 24): number {
  if (miles <= 0) return 0;
  const boardingBufferMinutes = 6;
  return Math.ceil((miles / averageMph) * 60) + boardingBufferMinutes;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
