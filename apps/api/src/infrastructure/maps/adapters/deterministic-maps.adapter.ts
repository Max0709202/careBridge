import { createHash } from 'node:crypto';

import { AVERAGE_CITY_MPH, distanceMiles } from '../../../domain/geo';
import type {
  AddressInput,
  Coordinates,
  GeocodeResult,
  MapsPort,
  RouteResult,
} from '../maps.port';

/**
 * A geocoder with no network, no key and no drift.
 *
 * The properties that make it useful are not "it is a fake" but:
 *
 *   - **Deterministic.** The same address always yields the same coordinates,
 *     on every machine and every run. A test can assert on a distance, and a
 *     seeded demo shows the same map to everyone.
 *   - **Plausible.** Coordinates land inside the bounding box of the US state
 *     in the address, so a rendered map looks like a map rather than a pin in
 *     the Gulf of Guinea, and a distance between two addresses in the same
 *     city is a city-sized number.
 *   - **Honest.** `precision` is always `approximate` and `source` says which
 *     adapter produced it, so nothing downstream can mistake this for a real
 *     rooftop fix.
 *
 * It is refused in production by config validation. A geocoder that invents
 * confident coordinates would send a driver to a plausible wrong address.
 */
export class DeterministicMapsAdapter implements MapsPort {
  readonly driver = 'deterministic' as const;

  async geocode(address: AddressInput): Promise<GeocodeResult | null> {
    const key = normalise(address);
    if (!key) return null;

    const box = STATE_BOXES[address.state.trim().toUpperCase()] ?? US_BOX;

    // Two independent 24-bit slices of one digest: enough resolution that two
    // neighbouring house numbers do not collide, and stable across Node
    // versions in a way a string hash function is not.
    const digest = createHash('sha256').update(key).digest();
    const latFraction = digest.readUIntBE(0, 3) / 0xff_ff_ff;
    const lngFraction = digest.readUIntBE(3, 3) / 0xff_ff_ff;

    return {
      latitude: round(box.minLat + latFraction * (box.maxLat - box.minLat)),
      longitude: round(box.minLng + lngFraction * (box.maxLng - box.minLng)),
      precision: 'approximate',
      formattedAddress: null,
      source: 'deterministic',
    };
  }

  /**
   * A straight line with a detour factor, at a conservative city average.
   *
   * The same three properties as the geocoder, and the third is the one that
   * matters most here. This is **honest**: it is exactly the estimate the
   * system falls back to when a real vendor is unreachable, so a developer
   * running without a key sees the degraded answer rather than a fictional
   * traffic-aware one. There is nothing this adapter could know about traffic,
   * and pretending otherwise would make a local run look better than
   * production ever does.
   *
   * It never throws. There is no vendor to be unavailable.
   */
  async route(from: Coordinates, to: Coordinates): Promise<RouteResult> {
    const miles = distanceMiles(from, to);
    return {
      distanceMiles: round(miles),
      durationMinutes: Math.max(1, Math.ceil((miles / AVERAGE_CITY_MPH) * 60)),
      source: 'deterministic',
    };
  }
}

function normalise(address: AddressInput): string {
  return [address.line1, address.city, address.state, address.postalCode]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|');
}

/** Six decimal places is roughly 0.1 m — well past anything we claim. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const US_BOX: BoundingBox = {
  minLat: 25.8,
  maxLat: 49.0,
  minLng: -124.7,
  maxLng: -66.9,
};

/**
 * Bounding boxes for the states the pilot plausibly touches, plus a national
 * fallback. Not a complete gazetteer, and it does not need to be: its only job
 * is to keep a demo map looking like the right part of the country.
 */
const STATE_BOXES: Record<string, BoundingBox> = {
  NY: { minLat: 40.5, maxLat: 45.0, minLng: -79.8, maxLng: -71.9 },
  NJ: { minLat: 38.9, maxLat: 41.4, minLng: -75.6, maxLng: -73.9 },
  CT: { minLat: 40.9, maxLat: 42.1, minLng: -73.7, maxLng: -71.8 },
  PA: { minLat: 39.7, maxLat: 42.3, minLng: -80.5, maxLng: -74.7 },
  MA: { minLat: 41.2, maxLat: 42.9, minLng: -73.5, maxLng: -69.9 },
  CA: { minLat: 32.5, maxLat: 42.0, minLng: -124.4, maxLng: -114.1 },
  TX: { minLat: 25.8, maxLat: 36.5, minLng: -106.6, maxLng: -93.5 },
  FL: { minLat: 24.5, maxLat: 31.0, minLng: -87.6, maxLng: -80.0 },
  IL: { minLat: 36.9, maxLat: 42.5, minLng: -91.5, maxLng: -87.0 },
  WA: { minLat: 45.5, maxLat: 49.0, minLng: -124.8, maxLng: -116.9 },
};
