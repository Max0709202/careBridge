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
}

export const MAPS = Symbol('MAPS');
