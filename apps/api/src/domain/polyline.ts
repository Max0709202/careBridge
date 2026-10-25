import type { Coordinates } from './geo';

/**
 * Decodes an encoded polyline — the compact route shape both Google's Routes
 * API (`encodedPolyline`) and OSRM (`geometries=polyline`) return, at five
 * decimal places.
 *
 * Returns null for anything malformed rather than a partial path: half a road
 * drawn confidently on a map is worse than the plain guide line the client
 * falls back to.
 */
export function decodePolyline(encoded: string, precision = 5): Coordinates[] | null {
  const factor = 10 ** precision;
  const points: Coordinates[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const dLat = nextValue(encoded, index);
    if (!dLat) return null;
    index = dLat.next;
    const dLon = nextValue(encoded, index);
    if (!dLon) return null;
    index = dLon.next;

    latitude += dLat.value;
    longitude += dLon.value;
    const point = { latitude: latitude / factor, longitude: longitude / factor };
    if (Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return null;
    points.push(point);
  }

  return points.length >= 2 ? points : null;
}

function nextValue(
  encoded: string,
  start: number,
): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  let index = start;

  for (;;) {
    if (index >= encoded.length) return null;
    const byte = encoded.charCodeAt(index++) - 63;
    if (byte < 0 || byte > 63) return null;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    if (byte < 0x20) break;
    // More than 32 bits of value is not a coordinate; it is garbage.
    if (shift > 30) return null;
  }

  return { value: result & 1 ? ~(result >> 1) : result >> 1, next: index };
}

/**
 * At most `max` points, keeping both ends and an even spread between.
 *
 * Applied before a path is cached or sent. A cross-town route is a few hundred
 * points; a vendor answer of tens of thousands would be a Redis value and a
 * response body nobody asked to pay for, and at map zoom the dropped points
 * are invisible.
 */
export function thinPath(path: Coordinates[], max = 500): Coordinates[] {
  if (path.length <= max) return path;
  const step = (path.length - 1) / (max - 1);
  const thinned: Coordinates[] = [];
  for (let i = 0; i < max; i++) thinned.push(path[Math.round(i * step)]!);
  return thinned;
}
