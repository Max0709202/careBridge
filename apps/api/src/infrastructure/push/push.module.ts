import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { PUSH, type PushPort } from './push.port';
import { FcmPushAdapter } from './adapters/fcm-push.adapter';
import { LogPushAdapter } from './adapters/log-push.adapter';
import { NoDevicePushAdapter } from './adapters/no-device-push.adapter';
import { WEB_PUSH, type WebPushPort } from './web-push/web-push.port';
import { NoWebPushAdapter, VapidWebPushAdapter } from './web-push/web-push.adapter';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PUSH,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PushPort => {
        if (config.PUSH_DRIVER === 'fcm' && config.FCM_SERVICE_ACCOUNT_JSON) {
          return new FcmPushAdapter(config.FCM_SERVICE_ACCOUNT_JSON);
        }
        return config.PUSH_DRIVER === 'none' ? new NoDevicePushAdapter() : new LogPushAdapter();
      },
    },
    {
      provide: WEB_PUSH,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): WebPushPort =>
        config.WEB_PUSH_VAPID_PUBLIC_KEY && config.WEB_PUSH_VAPID_PRIVATE_KEY
          ? new VapidWebPushAdapter({
              publicKey: config.WEB_PUSH_VAPID_PUBLIC_KEY,
              privateKey: config.WEB_PUSH_VAPID_PRIVATE_KEY,
              subject: config.WEB_PUSH_SUBJECT,
            })
          : new NoWebPushAdapter(),
    },
  ],
  exports: [PUSH, WEB_PUSH],
})
export class PushModule {}
