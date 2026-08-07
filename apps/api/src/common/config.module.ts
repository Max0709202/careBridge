import { Module } from '@nestjs/common';

import { appConfig } from './config';
import { APP_CONFIG } from './config.token';

/**
 * The validated configuration, as an injectable.
 *
 * Deliberately **not** `@Global()`. A dynamic module built by `registerAsync`
 * resolves its factory's dependencies against its own import list, and a global
 * module is not reliably visible there — so every consumer imports this one
 * explicitly instead. Nest reuses the single instance, and the dependency is
 * visible in each module's imports rather than being ambient.
 *
 * The factory runs once, at boot: a bad environment fails the container's first
 * second rather than the first request that happens to read the missing value.
 */
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => appConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
