import { z } from 'zod';

/**
 * Environment, validated once at boot.
 *
 * Direct `process.env` reads are banned everywhere else — by lint, not by
 * convention (see packages/eslint-config). A typo in an env name silently
 * becomes `undefined` at the call site and surfaces as a runtime bug hours
 * later, on the one code path nobody exercised. Here it fails the container's
 * first second, loudly, naming the variable.
 */

/** Vendors sit behind interfaces; this is where the live adapter is chosen. */
const mailDriver = z.enum(['smtp', 'log']).default('log');
const pushDriver = z.enum(['fcm', 'log']).default('log');
const mapsDriver = z.enum(['google', 'deterministic']).default('deterministic');
const paymentsDriver = z.enum(['stripe', 'local']).default('local');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Stamped on every log line, so a line can be traced to a build. */
  SERVICE_VERSION: z.string().default('0.2.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Queues, live location, idempotency and rate limiting.
   *
   * Optional on purpose. Without it the API runs with an in-process scheduler:
   * correct on one developer machine, wrong the moment there are two
   * instances, and it says exactly that at boot. Required in production.
   */
  REDIS_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),

  /**
   * Signing key for access tokens. Must be supplied — there is deliberately no
   * default, because a default JWT secret is a backdoor that ships to
   * production exactly once and is never noticed.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  /**
   * Encrypts TOTP shared secrets at rest, base64 of 32 bytes.
   *
   * Optional, and its absence disables MFA enrolment rather than degrading it:
   * a TOTP secret stored in plaintext turns a database dump into a box of
   * working second factors, which is worse than having no second factor,
   * because the user believes they have one.
   */
  MFA_SECRET_KEY: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),

  /** Short by design. Revocation is immediate because the window is small. */
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * Single-use credential lifetimes. Each is short enough that a link sitting
   * in a forwarded email or a shared inbox stops being useful quickly.
   */
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),

  /**
   * Comma-separated allowlist. `*` is accepted only outside production, so a
   * permissive local setting cannot leak into a deployed environment.
   */
  CORS_ORIGINS: z.string().default('*'),

  /**
   * How many proxies sit in front of this process.
   *
   * The compose stack and the production topology both put nginx in front, so
   * every request arrives from the proxy's address — and a per-IP rate limit
   * that sees one address for the entire internet is not a per-IP rate limit.
   * Express takes the client address from the right-hand end of
   * X-Forwarded-For, skipping this many hops.
   *
   * The number matters in both directions. Too low and everyone shares one
   * bucket. Too high and a caller can prepend their own X-Forwarded-For to
   * pose as a fresh address every request, which makes the limits decorative.
   * 1 is the deployment described in docker-compose.yml; set 0 when nothing is
   * in front, and only ever raise it to the number of proxies actually there.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  /**
   * Rate limits on the unauthenticated credential endpoints. Three policies,
   * because the three things being protected fail differently.
   *
   * Sign-in: failed attempts per email+IP before that pair is locked out, plus
   * a looser ceiling on attempts per IP regardless of which address they name
   * — the first stops a password being guessed, the second stops one host
   * spraying one password across many accounts.
   */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  SIGN_IN_IP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(30),

  /**
   * Email dispatch: registration, verification resend and password reset all
   * send mail to an address the caller names and are all deliberately
   * indistinguishable from a no-op. Without a limit they are a way to use this
   * system to deliver mail to a stranger, repeatedly. Counted per IP *and* per
   * address: per-IP alone lets one host mail a thousand addresses, per-address
   * alone lets a thousand hosts mail one.
   */
  EMAIL_DISPATCH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  EMAIL_DISPATCH_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),

  /**
   * Token guessing: email verification, password-reset confirmation,
   * invitation acceptance and MFA codes. These are single-use secrets, and a
   * six-digit TOTP code is only 10^6 wide — small enough to be worth grinding
   * if nothing counts the attempts.
   */
  TOKEN_GUESS_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  TOKEN_GUESS_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  // `silent` is a real pino level and the right one for a test run: the suite
  // asserts on behaviour, and a thousand log lines between two failures is how
  // a failing assertion becomes hard to find.
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Where a verification, reset or invitation link points. */
  PUBLIC_APP_URL: z.string().url().default('http://localhost:8080'),

  // ─── outbound adapters ─────────────────────────────────────────────────

  MAIL_DRIVER: mailDriver,
  MAIL_SMTP_HOST: z.string().default('127.0.0.1'),
  MAIL_SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_SMTP_USER: z.string().optional(),
  MAIL_SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('CareBridge <no-reply@carebridge.local>'),

  PUSH_DRIVER: pushDriver,
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),

  MAPS_DRIVER: mapsDriver,
  MAPS_API_KEY: z.string().optional(),

  /**
   * The processor that actually moves money — see ADR-0006.
   *
   * `local` decides an outcome from the card's last four digits, using
   * Stripe's own test-card meanings, so a decline and the dunning that follows
   * it can be reproduced on a laptop. Refused in production below, and it is
   * the most consequential of those refusals: an adapter that reports every
   * charge as settled is a system that bills nobody and says everything is
   * fine.
   */
  PAYMENTS_DRIVER: paymentsDriver,
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  /**
   * Signs the local adapter's webhooks.
   *
   * The local adapter verifies signatures rather than waving them through, so
   * the branch that rejects a forged "this invoice is paid" is the same code
   * in development as in production. Defaulted, because it protects nothing
   * real — the live secret is STRIPE_WEBHOOK_SECRET.
   */
  PAYMENTS_WEBHOOK_SECRET: z.string().min(1).default('local-webhook-secret'),

  /**
   * How long an invoice may sit open before the first charge is attempted.
   * Zero means the sweep charges it as soon as it is issued, which is what a
   * renewal wants; it is configuration because a pilot may want a delay.
   */
  INVOICE_DUE_HOURS: z.coerce.number().int().min(0).default(0),

  /**
   * Reminder offsets in minutes before the appointment, e.g. "1440,120" for a
   * day before and two hours before. Configuration rather than a constant,
   * because the right answer is an operational finding from the pilot.
   */
  APPOINTMENT_REMINDER_OFFSETS: z
    .string()
    .default('1440,120')
    .transform((raw, ctx) => {
      const offsets = raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map(Number);

      if (offsets.some((n) => !Number.isInteger(n) || n <= 0)) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a comma-separated list of positive whole minutes',
        });
        return z.NEVER;
      }
      // Descending: the earliest reminder is scheduled first, which is the
      // order a human reads them in when debugging a job queue.
      return [...new Set(offsets)].sort((a, b) => b - a);
    }),
});

export type AppConfig = z.infer<typeof schema> & {
  corsOrigins: string[] | true;
  isProduction: boolean;
  /** Decoded once, so every consumer does not re-parse base64. */
  mfaSecretKey: Buffer | null;
};

let cached: AppConfig | null = null;

/**
 * The process-wide configuration, validated on first use and reused after.
 *
 * Memoised rather than resolved through DI alone because `JwtModule
 * .registerAsync` builds its options provider inside its own dynamic module,
 * where an injected token from a sibling module is not reliably visible. A
 * plain function sidesteps that: both the DI provider and the JWT factory call
 * this, and both get the same validated object with no import-order to reason
 * about. Tests bypass it by calling `loadConfig(env)` with their own values.
 */
export function appConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test-only: forget the memoised value so the next call re-validates. */
export function resetConfigCache(): void {
  cached = null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const config = parsed.data;
  const isProduction = config.NODE_ENV === 'production';

  const origins = config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (isProduction && origins.includes('*')) {
    throw new Error('CORS_ORIGINS may not be "*" in production.');
  }

  // Production refuses the local adapters. Each of these silently succeeds
  // while doing nothing, which is the failure mode that is hardest to notice:
  // password resets that never arrive look identical to users not asking for
  // any, and a geocoder that invents coordinates sends a driver to a plausible
  // wrong address.
  if (isProduction) {
    const localAdapters: string[] = [];
    if (config.MAIL_DRIVER === 'log') localAdapters.push('MAIL_DRIVER=log');
    if (config.PUSH_DRIVER === 'log') localAdapters.push('PUSH_DRIVER=log');
    if (config.MAPS_DRIVER === 'deterministic') {
      localAdapters.push('MAPS_DRIVER=deterministic');
    }
    if (config.PAYMENTS_DRIVER === 'local') {
      localAdapters.push('PAYMENTS_DRIVER=local');
    }
    if (localAdapters.length > 0) {
      throw new Error(
        `These adapters do nothing but log, and must not run in production: ${localAdapters.join(', ')}.`,
      );
    }
    if (!config.REDIS_URL) {
      throw new Error(
        'REDIS_URL is required in production: the in-process fallbacks lose every pending job on deploy, double-fire with more than one instance, hold rate-limit counters per process — so the effective limit multiplies by the instance count — and keep live positions inside a single process, so a family connected to one instance never sees a car reporting to another.',
      );
    }
  }

  if (config.MAIL_DRIVER === 'smtp' && !config.MAIL_SMTP_HOST) {
    throw new Error('MAIL_SMTP_HOST is required when MAIL_DRIVER=smtp.');
  }
  if (config.PUSH_DRIVER === 'fcm' && !config.FCM_SERVICE_ACCOUNT_JSON) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is required when PUSH_DRIVER=fcm.');
  }
  if (config.MAPS_DRIVER === 'google' && !config.MAPS_API_KEY) {
    throw new Error('MAPS_API_KEY is required when MAPS_DRIVER=google.');
  }
  if (config.PAYMENTS_DRIVER === 'stripe') {
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required when PAYMENTS_DRIVER=stripe.');
    }
    // Without the webhook secret the API cannot verify that a "payment
    // succeeded" callback came from Stripe, and an unverified one is an
    // unauthenticated request marking an invoice paid. Refused at boot rather
    // than degraded to trusting the caller.
    if (!config.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required when PAYMENTS_DRIVER=stripe.');
    }
  }

  const mfaSecretKey = decodeMfaKey(config.MFA_SECRET_KEY);

  return {
    ...config,
    isProduction,
    corsOrigins: origins.includes('*') ? true : origins,
    mfaSecretKey,
  };
}

/**
 * AES-256-GCM needs exactly 32 bytes. A short key is rejected rather than
 * stretched: silently padding it would produce a system that encrypts, passes
 * every test, and has a fraction of the key space its name implies.
 */
function decodeMfaKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `MFA_SECRET_KEY must be 32 bytes, base64-encoded (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}
