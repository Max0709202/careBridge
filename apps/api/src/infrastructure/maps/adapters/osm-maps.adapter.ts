import { Logger } from '@nestjs/common';

import {
  MapsUnavailableError,
  type AddressInput,
  type Coordinates,
  type GeocodeResult,
  type MapsPort,
  type RouteResult,
} from '../maps.port';

export interface OsmMapsOptions {
  /** A Nominatim instance, e.g. https://nominatim.openstreetmap.org */
  geocoderUrl: string;
  /** An OSRM instance, e.g. https://router.project-osrm.org */
  routerUrl: string;
  /**
   * Sent in the User-Agent. The public Nominatim and OSRM servers require an
   * identifiable caller, and block anonymous ones without warning.
   */
  contact: string;
  /** ISO 3166-1 alpha-2, comma-separated; empty searches everywhere. */
  countryCodes: string;
}

/**
 * OpenStreetMap: Nominatim for geocoding, OSRM for routing.
 *
 * The keyless real adapter, for a deployment that owns its own host rather
 * than a cloud account. Unlike the deterministic adapter it answers from real
 * map data, so a pin is where the building is and a route follows roads — but
 * it is not traffic-aware, which is the one thing the Google adapter adds.
 *
 * The public servers are shared community infrastructure with a usage policy
 * (about one request a second, identified caller). This product stays well
 * inside it: geocoding happens when somebody saves an address, and routing is
 * behind the ETA cache and circuit breaker. Both base URLs are configuration so
 * a busier deployment points them at its own instances with no code change.
 *
 * The same privacy rules as the Google adapter: an address string or two
 * coordinates leave the process, and nothing that identifies a patient.
 */
export class OsmMapsAdapter implements MapsPort {
  readonly driver = 'osm' as const;

  private readonly logger = new Logger('Maps');
  private readonly userAgent: string;

  constructor(private readonly options: OsmMapsOptions) {
    this.userAgent = `CareBridge/1.0 (${options.contact})`;
  }

  async geocode(address: AddressInput): Promise<GeocodeResult | null> {
    const url = new URL('/search', this.options.geocoderUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');
    if (this.options.countryCodes) {
      url.searchParams.set('countrycodes', this.options.countryCodes);
    }
    // Structured rather than free-text: the form already separates the parts,
    // and a structured query cannot match a city's name against a street.
    const parts: Array<[string, string]> = [
      ['street', address.line1.trim()],
      ['city', address.city.trim()],
      ['state', address.state.trim()],
      ['postalcode', address.postalCode.trim()],
    ];
    const present = parts.filter(([, value]) => value !== '');
    if (present.length === 0) return null;
    for (const [key, value] of present) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      // The address text is not logged: it is somebody's home.
      this.logger.warn(
        `Geocoding request failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }

    if (!response.ok) {
      this.logger.warn(`Geocoding returned ${response.status}`);
      return null;
    }

    let body: NominatimResult[];
    try {
      body = (await response.json()) as NominatimResult[];
    } catch {
      this.logger.warn('Geocoding returned an unreadable body');
      return null;
    }

    const first = body[0];
    if (!first) return null;
    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      latitude,
      longitude,
      precision: precisionOf(first),
      formattedAddress: first.display_name ?? null,
      source: 'osm',
    };
  }

  async route(from: Coordinates, to: Coordinates): Promise<RouteResult | null> {
    // OSRM takes longitude first.
    const path = `/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const url = new URL(path, this.options.routerUrl);
    url.searchParams.set('overview', 'false');
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('steps', 'false');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        // Short for the same reason as the Google adapter: a slower answer
        // describes a place the car has already left.
        signal: AbortSignal.timeout(3_000),
      });
    } catch (error) {
      throw new MapsUnavailableError(
        error instanceof Error ? error.message : 'request failed',
      );
    }

    let body: OsrmRouteResponse;
    try {
      body = (await response.json()) as OsrmRouteResponse;
    } catch {
      throw new MapsUnavailableError(`unreadable response (status ${response.status})`);
    }

    // OSRM's documented answers for "there is no road between these": a real
    // answer, not an outage, so it is null rather than unavailable.
    if (body.code === 'NoRoute' || body.code === 'NoSegment') return null;
    if (!response.ok || body.code !== 'Ok') {
      this.logger.warn(`Routing returned ${response.status} ${body.code ?? ''}`.trim());
      throw new MapsUnavailableError(`status ${response.status}`);
    }

    const first = body.routes?.[0];
    if (!first) return null;
    if (!Number.isFinite(first.duration) || !Number.isFinite(first.distance)) {
      throw new MapsUnavailableError('route missing duration or distance');
    }

    return {
      distanceMiles: first.distance / METRES_PER_MILE,
      durationMinutes: Math.max(1, Math.round(first.duration / 60)),
      source: 'osm',
    };
  }
}

/**
 * Nominatim's place rank onto our three levels. 30 is a building or an
 * address point; 26–29 a street, where a house number was interpolated or
 * missed; anything coarser is a postcode or a town, which a driver cannot be
 * sent to.
 */
function precisionOf(result: NominatimResult): GeocodeResult['precision'] {
  const rank = result.place_rank ?? 0;
  if (rank >= 30) return 'rooftop';
  if (rank >= 26) return 'interpolated';
  return 'approximate';
}

const METRES_PER_MILE = 1609.344;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name?: string;
  place_rank?: number;
}

interface OsrmRouteResponse {
  code?: string;
  routes?: Array<{ duration: number; distance: number }>;
}
