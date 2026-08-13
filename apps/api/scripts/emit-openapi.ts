/**
 * Writes packages/contracts/openapi.json from the running decorators.
 *
 * The application is created with `NestFactory.create` but never listened on:
 * the document is built from metadata, so no port is bound and no database
 * connection is needed to produce it. That matters because CI regenerates this
 * on every pull request to check for drift, and a contract check that needs a
 * live Postgres is a contract check that gets disabled the first time it
 * flakes.
 */
import 'reflect-metadata';

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/common/openapi';
import { loadConfig } from '../src/common/config';

const OUTPUT = resolve(__dirname, '../../../packages/contracts/openapi.json');

async function main(): Promise<void> {
  // A fixed environment, so the emitted document does not depend on whatever
  // happens to be in the developer's .env. Two runs on two machines must
  // produce byte-identical output, or the drift check in CI is worthless.
  const config = loadConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://contract:contract@127.0.0.1:5432/contract',
    JWT_SECRET: 'contract-generation-only-not-a-real-secret',
    PORT: '3000',
    SERVICE_VERSION: process.env['SERVICE_VERSION'] ?? '0.2.0',
  });

  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildOpenApiDocument(app, config);

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  await app.close();

  const paths = Object.keys(document.paths ?? {}).length;
  const schemas = Object.keys(document.components?.schemas ?? {}).length;
  console.log(`openapi.json — ${paths} paths, ${schemas} schemas → ${OUTPUT}`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
