import { Logger } from '@nestjs/common';

import type { AddressInput, GeocodeResult, MapsPort } from '../maps.port';

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
