import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { MAPS, type MapsPort } from './maps.port';
import { DeterministicMapsAdapter } from './adapters/deterministic-maps.adapter';
import { GoogleMapsAdapter } from './adapters/google-maps.adapter';
import { OsmMapsAdapter } from './adapters/osm-maps.adapter';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAPS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MapsPort => {
        if (config.MAPS_DRIVER === 'google' && config.MAPS_API_KEY) {
          return new GoogleMapsAdapter(config.MAPS_API_KEY);
        }
        if (config.MAPS_DRIVER === 'osm' && config.MAPS_CONTACT) {
          return new OsmMapsAdapter({
            geocoderUrl: config.MAPS_GEOCODER_URL,
            routerUrl: config.MAPS_ROUTER_URL,
            contact: config.MAPS_CONTACT,
            countryCodes: config.MAPS_COUNTRY_CODES,
          });
        }
        return new DeterministicMapsAdapter();
      },
    },
  ],
  exports: [MAPS],
})
export class MapsModule {}
