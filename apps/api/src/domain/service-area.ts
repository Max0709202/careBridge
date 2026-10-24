import { ValidationError } from '../common/errors';
import { distanceMiles, type Coordinates } from './geo';

/**
 * Where a transport operator works.
 *
 * Two shapes, because operators describe their area two ways: "fifteen miles
 * round the depot" and "these neighbourhoods, drawn on a map". Both are kept
 * rather than reducing the first to a polygon, so the console can show the
 * operator the radius they typed instead of sixty-four vertices.
 *
 * Stored as JSON on the organisation and parsed through `parseServiceArea` on
 * every read, so a row written by an older shape fails loudly here rather than
 * quietly answering "outside" for every ride.
 */
export type ServiceArea =
  | { kind: 'radius'; center: Coordinates; radiusMiles: number }
  | { kind: 'polygon'; points: Coordinates[] };

export const SERVICE_AREA_KINDS = ['radius', 'polygon'] as const;

/** Larger than any metro area; a typo of an extra zero, not a real operator. */
export const MAX_SERVICE_RADIUS_MILES = 250;

/**
 * Enough for a hand-drawn outline of a county. The cap is about the request
 * body and the per-ride check, not about geography.
 */
export const MAX_POLYGON_POINTS = 500;

/**
 * Validates untrusted input — a request body or a JSON column — into a
 * `ServiceArea`. Throws `ValidationError` naming the offending field.
 */
export function parseServiceArea(input: unknown): ServiceArea {
  if (!isRecord(input)) throw new ValidationError('Describe the service area.', 'kind');

  if (input.kind === 'radius') {
    const center = parseCoordinates(input.center, 'center');
    const radiusMiles = input.radiusMiles;
    if (
      typeof radiusMiles !== 'number' ||
      !Number.isFinite(radiusMiles) ||
      radiusMiles <= 0 ||
      radiusMiles > MAX_SERVICE_RADIUS_MILES
    ) {
      throw new ValidationError(
        `The radius must be more than 0 and at most ${MAX_SERVICE_RADIUS_MILES} miles.`,
        'radiusMiles',
      );
    }
    return { kind: 'radius', center, radiusMiles };
  }

  if (input.kind === 'polygon') {
    const raw = input.points;
    if (!Array.isArray(raw) || raw.length < 3) {
      throw new ValidationError(
        'An area drawn on the map needs at least three points.',
        'points',
      );
    }
    if (raw.length > MAX_POLYGON_POINTS) {
      throw new ValidationError(
        `An area drawn on the map can have at most ${MAX_POLYGON_POINTS} points.`,
        'points',
      );
    }
    const points = raw.map((point) => parseCoordinates(point, 'points'));
    if (Math.abs(signedArea(points)) < 1e-12) {
      throw new ValidationError('The points drawn do not enclose an area.', 'points');
    }
    return { kind: 'polygon', points };
  }

  throw new ValidationError('The service area must be a radius or a polygon.', 'kind');
}

/**
 * Is this point inside the area?
 *
 * The radius is measured as the crow flies (no detour factor): an operator who
 * says "fifteen miles from the depot" means on the map, not by road. A point
 * exactly on a polygon's edge may land either side; at the scale of a street
 * address that is a distinction nobody can act on.
 */
export function isWithinServiceArea(area: ServiceArea, point: Coordinates): boolean {
  if (area.kind === 'radius') {
    return distanceMiles(area.center, point, 1) <= area.radiusMiles;
  }

  // Ray casting, treating longitude/latitude as a plane. Accurate enough for a
  // metro-sized outline that does not cross the antimeridian or a pole.
  let inside = false;
  const { points } = area;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    const crosses =
      a.latitude > point.latitude !== b.latitude > point.latitude &&
      point.longitude <
        ((b.longitude - a.longitude) * (point.latitude - a.latitude)) /
          (b.latitude - a.latitude) +
          a.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Whether a ride's pickup is inside the operator's area, or `null` when that
 * cannot be said: the operator has not set an area, or the pickup address was
 * never located. `null` is not "inside" — the console shows it as unknown.
 */
export function pickupCoverage(
  area: ServiceArea | null,
  pickup: { latitude: number | null; longitude: number | null },
): boolean | null {
  if (!area || pickup.latitude == null || pickup.longitude == null) return null;
  return isWithinServiceArea(area, {
    latitude: pickup.latitude,
    longitude: pickup.longitude,
  });
}

function parseCoordinates(input: unknown, field: string): Coordinates {
  if (
    !isRecord(input) ||
    typeof input.latitude !== 'number' ||
    typeof input.longitude !== 'number' ||
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    Math.abs(input.latitude) > 90 ||
    Math.abs(input.longitude) > 180
  ) {
    throw new ValidationError(
      'Each point needs a valid latitude and longitude.',
      field,
    );
  }
  return { latitude: input.latitude, longitude: input.longitude };
}

/** Shoelace formula; zero for points that are all on one line. */
function signedArea(points: Coordinates[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum +=
      points[j]!.longitude * points[i]!.latitude -
      points[i]!.longitude * points[j]!.latitude;
  }
  return sum / 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
