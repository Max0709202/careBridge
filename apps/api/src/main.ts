import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { APP_CONFIG } from './common/config.token';
import type { AppConfig } from './common/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix('api/v1');

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

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');

  new Logger('Bootstrap').log(
    `CareBridge API listening on :${config.PORT} (${config.NODE_ENV})`,
  );
}

void bootstrap();
