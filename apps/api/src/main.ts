import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import type { Logger as PinoLogger } from 'pino';

import { AppModule } from './app.module';
import { APP_CONFIG } from './common/config.token';
import type { AppConfig } from './common/config';
import { LOGGER } from './common/logging/logger.token';
import { NestPinoLogger } from './common/logging/logger';
import { mountOpenApi } from './common/openapi';

async function bootstrap(): Promise<void> {
  // Buffered until the pino logger is resolved, so the framework's own startup
  // lines go through the redaction denylist like everything else rather than
  // being printed by Nest's default logger before we can replace it.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get<AppConfig>(APP_CONFIG);
  const rootLogger = app.get<PinoLogger>(LOGGER);
  const logger = new NestPinoLogger(rootLogger);
  app.useLogger(logger);

  app.setGlobalPrefix('api/v1');

  // nginx is the only thing that talks to this process directly, so the
  // client's address is in X-Forwarded-For rather than on the socket. Without
  // this every rate limit is keyed on the proxy and the whole internet shares
  // one bucket; with it set too high, a caller forges the header and gets a
  // fresh bucket per request. See TRUST_PROXY_HOPS in config.ts.
  const express = app.getHttpAdapter().getInstance() as {
    set(setting: string, value: unknown): void;
  };
  express.set('trust proxy', config.TRUST_PROXY_HOPS);

  app.use(
    helmet({
      // The API serves JSON to a separate origin; CSP here would only
      // constrain responses no browser renders as a document.
      contentSecurityPolicy: false,
    }),
  );

  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    exposedHeaders: ['x-correlation-id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Anything not on the DTO is dropped rather than passed through, so a
      // client cannot smuggle a field a service might later start reading.
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  mountOpenApi(app, config);

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');

  rootLogger.info(
    {
      context: 'Bootstrap',
      port: config.PORT,
      // `env` is already a base binding on every line; repeating it here
      // produces a duplicate key, and a JSON log line with one is a line some
      // parsers keep the first value of and others the last.
      //
      // Which adapter is live is the first thing anyone asks when an email did
      // not arrive, so it is stated at boot rather than inferred from config.
      adapters: {
        mail: config.MAIL_DRIVER,
        push: config.PUSH_DRIVER,
        maps: config.MAPS_DRIVER,
        scheduler: config.REDIS_URL ? 'bullmq' : 'in-process',
      },
    },
    'CareBridge API listening',
  );

  if (!config.REDIS_URL) {
    rootLogger.warn(
      { context: 'Bootstrap' },
      'No REDIS_URL: using the in-process scheduler. Pending jobs are lost on restart and will double-fire if a second instance starts. Correct for one developer machine, wrong for anything else.',
    );
  }
}

void bootstrap();
