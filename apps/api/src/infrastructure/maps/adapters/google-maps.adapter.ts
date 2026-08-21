import { Logger } from '@nestjs/common';

import {
  MapsUnavailableError,
  type AddressInput,
  type Coordinates,
  type GeocodeResult,
  type MapsPort,
  type RouteResult,
} from '../maps.port';

/**
 * Google Geocoding API.
 *
 * Two things here are deliberate and both are privacy decisions rather than
 * technical ones:
 *
 *   - **No patient identity leaves the process.** The request carries an
 *     address string and nothing else — no name, no patient id, no
 *     appointment. The vendor learns that somebody geocoded an address, which
 *     is the minimum the operation requires.
 *   - **A failed lookup returns null, not an exception.** Vendor availability
 *     is not something a family creating a clinic record should experience as
 *     an error.
 */
export class GoogleMapsAdapter implements MapsPort {
  readonly driver = 'google' as const;

  private readonly logger = new Logger('Maps');

  constructor(private readonly apiKey: string) {}

  async geocode(address: AddressInput): Promise<GeocodeResult | null> {
    const query = [address.line1, address.city, address.state, address.postalCode]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');

    if (!query) return null;

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('components', 'country:US');

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      // The address text is not logged: it is on the redaction denylist and it
      // is somebody's home.
      this.logger.warn(
        `Geocoding request failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }

    if (!response.ok) {
      this.logger.warn(`Geocoding returned ${response.status}`);
      return null;
    }

    const body = (await response.json()) as GoogleGeocodeResponse;

    if (body.status === 'ZERO_RESULTS') return null;
    if (body.status !== 'OK') {
      this.logger.warn(`Geocoding status ${body.status}`);
      return null;
    }

    const first = body.results?.[0];
    if (!first) return null;

    return {
      latitude: first.geometry.location.lat,
      longitude: first.geometry.location.lng,
      precision: mapPrecision(first.geometry.location_type),
      formattedAddress: first.formatted_address ?? null,
      source: 'google',
    };
  }

  /**
   * The Routes API, asked for traffic-aware driving time.
   *
   * `TRAFFIC_AWARE` rather than `TRAFFIC_AWARE_OPTIMAL`: the optimal mode is
   * several times the price for an accuracy difference measured in seconds,
   * and routing spend is the one vendor cost that grows exactly as the product
   * succeeds (R4).
   *
   * The field mask is not an optimisation. Google bills this endpoint by which
   * fields are requested, and asking for the default set would return a full
   * polyline and step-by-step instructions — data this product has no use for,
   * at a materially higher tier. Asking for two numbers is the whole
   * requirement.
   *
   * Two coordinates leave the process and nothing else: no ride id, no
   * patient, no address text. The vendor learns that somebody drove between
   * two points.
   */
  async route(from: Coordinates, to: Coordinates): Promise<RouteResult | null> {
    let response: Response;
    try {
      response = await fetch(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
          },
          body: JSON.stringify({
            origin: { location: { latLng: latLng(from) } },
            destination: { location: { latLng: latLng(to) } },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
          }),
          // Shorter than the geocoding timeout, and deliberately. This sits
          // behind a position report that arrives every few seconds; a call
          // that takes longer than the gap between reports has already lost,
          // because the answer describes a place the car has left.
          signal: AbortSignal.timeout(3_000),
        },
      );
    } catch (error) {
      throw new MapsUnavailableError(
        error instanceof Error ? error.message : 'request failed',
      );
    }

    // 4xx is our fault — a bad key, a malformed body, a quota that has run
    // out — and retrying will not fix it, but it is still a state where we do
    // not know the answer. Both map to unavailable so the breaker stops the
    // calls; the log is what distinguishes them for whoever has to fix it.
    if (!response.ok) {
      this.logger.warn(`Routing returned ${response.status}`);
      throw new MapsUnavailableError(`status ${response.status}`);
    }

    let body: GoogleRoutesResponse;
    try {
      body = (await response.json()) as GoogleRoutesResponse;
    } catch {
      throw new MapsUnavailableError('unreadable response');
    }

    const first = body.routes?.[0];
    // An empty `routes` array is the documented answer for "no route exists",
    // which is a real answer rather than a failure: two points with no road
    // between them will not acquire one by being asked again.
    if (!first) return null;

    const seconds = parseSeconds(first.duration);
    if (seconds === null || first.distanceMeters === undefined) {
      throw new MapsUnavailableError('route missing duration or distance');
    }

    return {
      distanceMiles: first.distanceMeters / METRES_PER_MILE,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      source: 'google',
    };
  }
}

function latLng(point: Coordinates): { latitude: number; longitude: number } {
  return { latitude: point.latitude, longitude: point.longitude };
}

/** `"612s"` — a protobuf duration, which JSON has no type for. */
function parseSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Google's `location_type` collapsed onto our three levels. `GEOMETRIC_CENTER`
 * and `APPROXIMATE` both become `approximate`, because for the purpose that
 * matters — can a driver be sent here — they are the same answer: no.
 */
function mapPrecision(locationType: string | undefined): GeocodeResult['precision'] {
  switch (locationType) {
    case 'ROOFTOP':
      return 'rooftop';
    case 'RANGE_INTERPOLATED':
      return 'interpolated';
    default:
      return 'approximate';
  }
}

/** Metres to miles, and seconds to minutes, in one place. */
const METRES_PER_MILE = 1609.344;

interface GoogleRoutesResponse {
  routes?: Array<{
    /** Google returns a protobuf duration as a string: "612s". */
    duration?: string;
    distanceMeters?: number;
  }>;
}

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{
    formatted_address?: string;
    geometry: {
      location: { lat: number; lng: number };
      location_type?: string;
    };
  }>;
}
