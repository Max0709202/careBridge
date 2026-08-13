import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MAPS, type MapsPort } from '../../infrastructure/maps/maps.port';

export interface GeocodableAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Turns an address into coordinates, and records how much to trust them.
 *
 * Two rules, both of which exist because the alternative sends a car to the
 * wrong place:
 *
 *   - **A caller-supplied coordinate wins.** If the client already has a pin —
 *     because the user dragged one on a map, or picked from an autocomplete —
 *     that is better information than anything we can derive from the text,
 *     and re-geocoding over it would silently move the marker the user set.
 *   - **Failure is not an error.** People mistype postcodes and rural
 *     addresses genuinely resolve to nothing. The clinic is still created; it
 *     is created without coordinates, and the record says so.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAPS) private readonly maps: MapsPort,
  ) {}

  /**
   * Resolves coordinates for an address about to be written.
   *
   * Returns the fields to merge into the `Address` create, so the caller does
   * one write rather than creating a row and then updating it — which would
   * leave a window where a clinic exists with no pin and a client that
   * fetched in between shows it that way until the next refresh.
   */
  async resolve(address: GeocodableAddress): Promise<{
    latitude: number | null;
    longitude: number | null;
    geocodePrecision: string | null;
    geocodeSource: string | null;
    geocodedAt: Date | null;
  }> {
    if (address.latitude != null && address.longitude != null) {
      return {
        latitude: address.latitude,
        longitude: address.longitude,
        // The client pinned it. We do not know how — a dragged marker or an
        // autocomplete pick — so the precision is recorded as unverified
        // rather than upgraded to a claim we cannot support.
        geocodePrecision: 'client',
        geocodeSource: 'client',
        geocodedAt: new Date(),
      };
    }

    const result = await this.maps.geocode({
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    });

    if (!result) {
      this.logger.debug('Address could not be geocoded; stored without a pin');
      return {
        latitude: null,
        longitude: null,
        geocodePrecision: null,
        geocodeSource: null,
        geocodedAt: null,
      };
    }

    return {
      latitude: result.latitude,
      longitude: result.longitude,
      geocodePrecision: result.precision,
      geocodeSource: result.source,
      geocodedAt: new Date(),
    };
  }

  /**
   * Fills in the pin for addresses that never got one.
   *
   * Runs from the retention/maintenance queue rather than on read: a geocoding
   * call on a read path turns a vendor outage into a page that will not load,
   * and turns a list of fifty clinics into fifty billable lookups.
   */
  async backfill(limit = 50, tx?: Prisma.TransactionClient): Promise<number> {
    const db = tx ?? this.prisma;

    const pending = await db.address.findMany({
      where: { latitude: null, geocodedAt: null },
      take: limit,
    });

    let filled = 0;
    for (const address of pending) {
      const resolved = await this.resolve(address);
      if (resolved.latitude == null) continue;

      await db.address.update({ where: { id: address.id }, data: resolved });
      filled += 1;
    }
    return filled;
  }
}
