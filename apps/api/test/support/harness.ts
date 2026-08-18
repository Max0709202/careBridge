import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  MAIL,
  type MailMessage,
  type MailPort,
} from '../../src/infrastructure/mail/mail.port';
import { resetConfigCache } from '../../src/common/config';

/**
 * The integration harness.
 *
 * It builds the **real** application — the same global guard, the same
 * validation pipe, the same error filter — because the things most worth
 * testing here are exactly the things a mocked application would not have.
 * `AuthGuard` being registered globally is a property of `AppModule`; a test
 * that wires controllers by hand proves nothing about whether a new endpoint
 * ships unprotected.
 */
export class TestHarness {
  private constructor(
    readonly app: INestApplication,
    readonly prisma: PrismaService,
    readonly mail: CapturingMailAdapter,
  ) {}

  static async create(): Promise<TestHarness> {
    resetConfigCache();

    const mail = new CapturingMailAdapter();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The only substitution. Mail is the one adapter whose *content* a test
      // needs to read — a verification link is only observable in the email
      // that carries it, and reaching into the token table instead would test
      // a different thing than the one users experience.
      .overrideProvider(MAIL)
      .useValue(mail)
      .compile();

    const app = moduleRef.createNestApplication({ logger: false });

    app.setGlobalPrefix('api/v1');
    // Same as main.ts: the rate-limit tests set X-Forwarded-For to act as
    // distinct clients, and that only works if the application reads it the
    // way the deployed one does.
    (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
      'trust proxy',
      1,
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );

    await app.init();

    return new TestHarness(app, app.get(PrismaService), mail);
  }

  get http() {
    // `getHttpServer()` is typed `any` by Nest. Narrowed here so the `any`
    // stops at the harness rather than spreading through every test file.
    return request(this.app.getHttpServer() as Parameters<typeof request>[0]);
  }

  /**
   * Empties every table between tests.
   *
   * `TRUNCATE ... CASCADE` in one statement rather than a delete per table:
   * it does not care about foreign-key ordering, which means adding a table to
   * the schema does not silently break test isolation until someone notices
   * a leaked row three suites later.
   */
  async reset(): Promise<void> {
    const tables = await this.prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;

    if (tables.length === 0) return;

    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await this.prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
    );

    this.mail.clear();
    await this.seedReferenceData();
  }

  /**
   * Operational reference data the application legitimately requires.
   *
   * The pricing rule is not fixture data — it is configuration the product
   * refuses to run without, and deliberately so: `activePricingRule` throws
   * rather than inventing a price, because a made-up charge is worse than a
   * failed request. Truncating it away and then testing ride creation would be
   * testing an environment that cannot exist.
   */
  private async seedReferenceData(): Promise<void> {
    await this.prisma.pricingRule.upsert({
      where: { version: 'v1-test' },
      update: {},
      create: {
        version: 'v1-test',
        baseFareCents: 1200,
        perMileCents: 225,
        perMinuteCents: 45,
        minimumFareCents: 1800,
        wheelchairSurchargeCents: 1500,
        assistanceSurchargeCents: 800,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
        active: true,
      },
    });
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}

/**
 * Captures what would have been sent.
 *
 * Tests assert on the *content* — that a verification email carries a working
 * link, that a notification email carries no clinic name — which is the only
 * place those properties are actually observable.
 */
export class CapturingMailAdapter implements MailPort {
  readonly driver = 'log' as const;
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage) {
    this.sent.push(message);
    return { providerRef: `test:${this.sent.length}` };
  }

  async verify(): Promise<boolean> {
    return true;
  }

  clear(): void {
    this.sent.length = 0;
  }

  /** The most recent message to an address, or undefined. */
  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === email.toLowerCase());
  }

  /**
   * Pulls the single-use token out of the link in the most recent message.
   *
   * Reading it from the email rather than from the database is deliberate: it
   * exercises the same path a user does, so a template that builds a broken
   * URL fails a test instead of failing a customer.
   */
  tokenFor(email: string): string {
    const message = this.lastTo(email);
    if (!message) {
      throw new Error(`No email was sent to ${email}. Sent: ${this.sent.length}`);
    }

    const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(message.text);
    if (!match?.[1]) {
      throw new Error(`No token in the email to ${email}:\n${message.text}`);
    }
    return match[1];
  }
}

/** Unwraps the API's error envelope for assertions. */
export function errorOf(response: Response): {
  code: string;
  message: string;
  correlationId: string;
  field?: string;
} {
  const body = response.body as {
    error?: { code: string; message: string; correlationId: string; field?: string };
  };
  if (!body.error) {
    throw new Error(
      `Expected an error envelope, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return body.error;
}
