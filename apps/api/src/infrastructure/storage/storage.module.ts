import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { STORAGE, type StoragePort } from './storage.port';
import { FilesystemStorageAdapter } from './adapters/filesystem-storage.adapter';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';
import { LocalStorageController } from './local-storage.controller';

/**
 * Object storage, resolved once.
 *
 * The controller is registered unconditionally and does nothing unless the
 * filesystem adapter is live — see its docblock. Registering it conditionally
 * would mean the route table differs between environments, which is a class of
 * surprise worth more than the handful of bytes it saves.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [LocalStorageController],
  providers: [
    {
      provide: STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): StoragePort =>
        config.STORAGE_DRIVER === 's3'
          ? new S3StorageAdapter({
              bucket: config.STORAGE_BUCKET,
              region: config.STORAGE_REGION,
              endpoint: config.STORAGE_ENDPOINT,
              accessKeyId: config.STORAGE_ACCESS_KEY_ID,
              secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
            })
          : new FilesystemStorageAdapter(
              config.STORAGE_LOCAL_ROOT,
              `${config.PUBLIC_APP_URL.replace(/\/+$/, '')}/api/v1`,
            ),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
