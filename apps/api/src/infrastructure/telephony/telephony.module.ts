import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { TELEPHONY, type TelephonyPort } from './telephony.port';
import { LogTelephonyAdapter } from './adapters/log-telephony.adapter';
import { NoTelephonyAdapter } from './adapters/no-telephony.adapter';
import { TwilioTelephonyAdapter } from './adapters/twilio-telephony.adapter';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TELEPHONY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TelephonyPort => {
        switch (config.TELEPHONY_DRIVER) {
          case 'twilio':
            // Presence is checked by config validation.
            return new TwilioTelephonyAdapter({
              accountSid: config.TWILIO_ACCOUNT_SID ?? '',
              authToken: config.TWILIO_AUTH_TOKEN ?? '',
              webhookBaseUrl: config.TELEPHONY_WEBHOOK_BASE_URL ?? '',
            });
          case 'log':
            return new LogTelephonyAdapter(config.TELEPHONY_LOG_STEP_MS);
          case 'none':
            return new NoTelephonyAdapter();
        }
      },
    },
  ],
  exports: [TELEPHONY],
})
export class TelephonyModule {}
