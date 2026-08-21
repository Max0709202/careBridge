/**
 * Geocoding and routing, independent of the vendor.
 *
 * Behind an interface from the first line of code because of R4: map and
 * routing spend scales with tracked rides, and the response to that is either
 * caching or changing vendor. Neither should be a rewrite. T6 assumes one
 * vendor covers maps, geocoding and ETA; this port is what makes that
 * assumption cheap to be wrong about.
 */

export interface AddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeocodeResult extends Coordinates {
  /**
   * How much to trust it. `approximate` means we located the postcode, not the
   * building — a driver navigating to it needs the access notes, and the UI
   * should not draw a confident pin.
   */
  precision: 'rooftop' | 'interpolated' | 'approximate';

  /** The vendor's normalised address, where it returns one. */
  formattedAddress: string | null;

  /** Which adapter produced this, recorded so a bad pin can be explained. */
  source: string;
}

/** A drivable route between two points. */
export interface RouteResult {
  distanceMiles: number;

  /**
   * Drive time, without any boarding allowance. The caller decides whether a
   * buffer belongs on top; a fare estimate wants one and a live countdown does
   * not.
   */
  durationMinutes: number;

  /** Which adapter produced this, recorded so a wrong ETA can be explained. */
  source: string;
}

/**
 * The vendor could not be reached, or answered with something unusable.
 *
 * Distinct from `route` returning null, and the distinction is the whole
 * reason this exists: **null means there is no route** — two points with no
 * road between them, which asking again will not change — while this means
 * **we do not know**, which is a temporary condition the caller should stop
 * asking about for a while. A circuit breaker cannot be written without being
 * able to tell those apart.
 *
 * It never reaches a user. Everything above the port falls back to a
 * straight-line estimate, so an outage costs accuracy rather than the feature.
 */
export class MapsUnavailableError extends Error {
  constructor(reason: string) {
    super(`Routing unavailable: ${reason}`);
    this.name = 'MapsUnavailableError';
  }
}

export interface MapsPort {
  readonly driver: 'google' | 'deterministic';

  /**
   * Returns `null` when the address cannot be located, rather than throwing.
   *
   * An un-geocodable address is a normal outcome — people mistype postcodes,
   * and rural addresses genuinely resolve to nothing. The clinic still gets
   * created; it is simply created without coordinates, and the UI says so.
   * Throwing here would make a typo in a postcode block the creation of a
   * clinic record.
   */
  geocode(address: AddressInput): Promise<GeocodeResult | null>;

  /**
   * Road distance and drive time between two points.
   *
   * Note the asymmetry with `geocode`, which swallows every failure: this one
   * **throws** `MapsUnavailableError` when the vendor cannot be reached. The
   * two are on different kinds of path and that is the reason. Geocoding
   * happens when somebody is creating a clinic record, where a vendor outage
   * must not become a form that will not submit. Routing happens behind a
   * position report, where the caller has a real fallback and needs to know to
   * use it — and needs to know to stop calling.
   */
  route(from: Coordinates, to: Coordinates): Promise<RouteResult | null>;
}

export const MAPS = Symbol('MAPS');
