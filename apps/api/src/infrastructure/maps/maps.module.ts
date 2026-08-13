import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { MAPS, type MapsPort } from './maps.port';
import { DeterministicMapsAdapter } from './adapters/deterministic-maps.adapter';
import { GoogleMapsAdapter } from './adapters/google-maps.adapter';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAPS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MapsPort =>
        config.MAPS_DRIVER === 'google' && config.MAPS_API_KEY
          ? new GoogleMapsAdapter(config.MAPS_API_KEY)
          : new DeterministicMapsAdapter(),
    },
  ],
  exports: [MAPS],
})
export class MapsModule {}
