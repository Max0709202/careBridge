import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import type { AppConfig } from './config';

/**
 * The contract, built from the decorators on the controllers and DTOs.
 *
 * There is exactly one description of this API and it is the code (T7). The
 * document below is generated from it, committed to
 * `packages/contracts/openapi.json`, and the Dart client is generated from
 * that. A hand-maintained spec drifts from the implementation the first week,
 * and the drift is discovered by a client developer, not by a test.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  config: AppConfig,
): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('CareBridge API')
    .setDescription(
      [
        'Coordination for an older relative’s medical appointments and the transport to them.',
        '',
        'Two conventions hold across every endpoint:',
        '',
        '- **Errors** use one envelope: `{ error: { code, message, correlationId, field? } }`.',
        '- **`404 not_found_or_forbidden` is deliberately ambiguous.** "No such record" and',
        '  "not yours" return an identical response, so the API cannot be used to probe for',
        '  the existence of a patient, a ride or an account.',
        '',
        'This service stores no diagnoses, medications, clinical notes or dates of birth.',
        'See `docs/FOUNDATION.md` §9.',
      ].join('\n'),
    )
    .setVersion(config.SERVICE_VERSION)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Short-lived access token from POST /auth/login. Carries the user id and nothing else — roles, organisations and patient grants are resolved server-side per request so revocation takes effect on the next call.',
      },
      'access-token',
    )
    .addTag('auth', 'Registration, sign-in, sessions, verification and recovery')
    .addTag('me', 'The signed-in account: profile, preferences, devices, consents')
    .addTag('patients', 'Patients, family access and invitations')
    .addTag('clinics', 'Clinics and their geocoded locations')
    .addTag('appointments', 'Appointments, rescheduling and reminders')
    .addTag('rides', 'Transport requests and their timeline')
    .addTag('notifications', 'The in-app centre and per-channel preferences')
    .addTag('care', 'The one-shot state snapshot the app opens with')
    .addTag('system', 'Health and readiness');

  for (const url of serverUrls(config)) {
    builder.addServer(url.url, url.description);
  }

  return SwaggerModule.createDocument(app, builder.build(), {
    // Operation ids become Dart method names. Deriving them from the
    // controller and handler names keeps them stable across refactors of
    // anything else.
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    deepScanRoutes: true,
  });
}

/**
 * Served at `/api/v1/docs`, and **never in production**.
 *
 * Not because the shape of the API is a secret — it is published to clients —
 * but because an interactive console on a production host is an invitation to
 * try things against real records, and the audit log fills with actions nobody
 * meant to take.
 */
export function mountOpenApi(app: INestApplication, config: AppConfig): void {
  if (config.isProduction) return;

  const document = buildOpenApiDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    jsonDocumentUrl: 'api/v1/docs.json',
  });
}

function serverUrls(config: AppConfig): Array<{ url: string; description: string }> {
  if (config.isProduction) return [];
  return [
    { url: `http://localhost:${config.PORT}`, description: 'Local API, direct' },
    { url: 'http://localhost:8080', description: 'Local, through the nginx proxy' },
  ];
}
