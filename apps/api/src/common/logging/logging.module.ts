import { Global, Module } from '@nestjs/common';

import { APP_CONFIG } from '../config.token';
import type { AppConfig } from '../config';
import { createRootLogger } from './logger';
import { LOGGER } from './logger.token';
import { ConfigModule } from '../config.module';
import { RequestLoggerMiddleware } from './request-logger.middleware';

/**
 * Global, because the logger is genuinely ambient: there is one per process,
 * every module wants it, and making each import it would add an import line to
 * every module file for no gain in clarity.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: LOGGER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createRootLogger({
          level: config.LOG_LEVEL,
          // Pretty output is a development convenience. In production the log
          // is a machine artefact — CloudWatch Insights cannot query prose.
          pretty: !config.isProduction && config.LOG_PRETTY,
          serviceVersion: config.SERVICE_VERSION,
          environment: config.NODE_ENV,
        }),
    },
    RequestLoggerMiddleware,
  ],
  exports: [LOGGER, RequestLoggerMiddleware],
})
export class LoggingModule {}
