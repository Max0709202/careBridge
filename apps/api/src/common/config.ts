import { isAbsolute } from 'node:path';

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
/**
 * `none` is not `log` renamed. `log` stands in for a vendor that should be
 * there; `none` declares a deployment with no device apps — the web apps show
 * the same notifications in their inbox, and there is no device to push to.
 */
const pushDriver = z.enum(['fcm', 'log', 'none']).default('log');
const mapsDriver = z.enum(['google', 'osm', 'deterministic']).default('deterministic');
const storageDriver = z.enum(['s3', 'filesystem']).default('filesystem');
const paymentsDriver = z.enum(['stripe', 'local']).default('local');
/**
 * `none` by default, not `log`: calling is a feature a deployment opts into
 * once it has a relay number, and until then the apps say calling is not set
 * up rather than pretending to ring someone. `log` walks a call through its
 * states on timers, for development and tests.
 */
const telephonyDriver = z.enum(['twilio', 'log', 'none']).default('none');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * The interface to listen on. Every interface suits a container, whose
   * network is private; on a host with a reverse proxy in front it must be
   * loopback, or a caller can skip the proxy and forge the forwarded address
   * that TRUST_PROXY_HOPS tells us to believe.
   */
  HOST: z.string().default('0.0.0.0'),

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

  // Per signed-in user, not per IP: a dispatch office is a dozen people
  // behind one address. Sending is generous — a real conversation at the
  // kerb is quick — and exists to stop a stuck client looping. Calls are
  // tight because every one of them is billed by the telephony provider.
  MESSAGE_SEND_MAX_PER_MINUTE: z.coerce.number().int().positive().default(30),
  CALL_START_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  CALL_START_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
  // An operator looking up an account to put on its roster. Each answer says
  // whether an address has a verified account, so this is the line between
  // onboarding a few drivers and walking a list of addresses.
  ACCOUNT_LOOKUP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(30),
  ACCOUNT_LOOKUP_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),

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

  /**
   * Web Push (VAPID) for the React web apps — background notifications in a
   * browser. Both keys or neither; generate them with
   * `npx ts-node scripts/generate-vapid-keys.ts`. Without them, browsers
   * simply are not offered background notifications.
   */
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().default('mailto:support@carebridge.example'),

  // ─── relay calls (ADR-0014) ─────────────────────────────────────────────
  TELEPHONY_DRIVER: telephonyDriver,
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** The number both sides see. E.164. */
  TELEPHONY_RELAY_NUMBER: z.string().default('+15550100000'),
  /**
   * The API's public base, as the provider reaches it — webhooks are signed
   * over the exact URL, so this must be what the provider calls, not what the
   * container thinks its hostname is. e.g. https://carebridge.example/api/v1
   */
  TELEPHONY_WEBHOOK_BASE_URL: z.string().url().optional(),
  /** Country code assumed for numbers written without one. */
  TELEPHONY_DEFAULT_COUNTRY_CODE: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .default('1'),
  /** `log` only: how long each simulated step takes. */
  TELEPHONY_LOG_STEP_MS: z.coerce.number().int().positive().default(1500),

  MAPS_DRIVER: mapsDriver,
  MAPS_API_KEY: z.string().optional(),
  /** The OpenStreetMap adapter's servers; point them at your own instances as volume grows. */
  MAPS_GEOCODER_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  MAPS_ROUTER_URL: z.string().url().default('https://router.project-osrm.org'),
  /**
   * An address the OpenStreetMap operators can reach you at. Their usage
   * policy requires an identifiable caller; required when MAPS_DRIVER=osm.
   */
  MAPS_CONTACT: z.string().optional(),
  MAPS_COUNTRY_CODES: z.string().default('us'),

  /**
   * Where driver documents live — see ADR-0012.
   *
   * `filesystem` plays out the whole pre-signed-URL flow against a local
   * directory, so a developer exercises the same shape the deployed system
   * uses rather than a multipart upload that exists nowhere else. It is
   * refused in production below, because an insurance certificate on a
   * container's ephemeral disk is a document that vanishes at the next deploy.
   */
  STORAGE_DRIVER: storageDriver,
  STORAGE_BUCKET: z.string().default('carebridge-documents'),
  STORAGE_REGION: z.string().default('us-east-1'),
  /** Set for MinIO and other S3-compatible endpoints; absent for real S3. */
  STORAGE_ENDPOINT: z.string().optional(),
  /**
   * Absent in production on purpose: the container carries an IAM task role
   * and the SDK's default provider chain finds it, so there are no keys in the
   * environment to leak, rotate or commit. These exist for MinIO.
   */
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  /** Where the filesystem adapter keeps objects, and mints URLs against. */
  STORAGE_LOCAL_ROOT: z.string().default('./.storage'),
  /**
   * The filesystem adapter on a disk that outlives deploys — a single host
   * that is the deployment, rather than a container. Production accepts the
   * adapter only with this set and an absolute STORAGE_LOCAL_ROOT, so the
   * choice is a statement about the disk rather than a default nobody made.
   */
  STORAGE_LOCAL_DURABLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Where the filesystem adapter's URLs point. Defaults to PUBLIC_APP_URL's
   * API; set `/api/v1` when several web apps on different origins each proxy
   * the API, so an upload from any of them stays same-origin.
   */
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),

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
   * A pilot that charges nobody, on purpose. Production accepts the local
   * payments adapter only with this set, and says so at boot: plans can be
   * chosen and seats counted, but no money moves until Stripe is configured.
   */
  PAYMENTS_UNBILLED_PILOT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
    if (config.TELEPHONY_DRIVER === 'log') {
      localAdapters.push(
        'TELEPHONY_DRIVER=log (use twilio, or none to switch calling off)',
      );
    }
    if (config.MAPS_DRIVER === 'deterministic') {
      localAdapters.push('MAPS_DRIVER=deterministic');
    }
    if (config.PAYMENTS_DRIVER === 'local' && !config.PAYMENTS_UNBILLED_PILOT) {
      localAdapters.push(
        'PAYMENTS_DRIVER=local (set PAYMENTS_UNBILLED_PILOT=true to run a pilot that charges nobody)',
      );
    }
    if (
      config.STORAGE_DRIVER === 'filesystem' &&
      !(config.STORAGE_LOCAL_DURABLE && isAbsolute(config.STORAGE_LOCAL_ROOT))
    ) {
      localAdapters.push(
        'STORAGE_DRIVER=filesystem (without STORAGE_LOCAL_DURABLE=true and an absolute STORAGE_LOCAL_ROOT)',
      );
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
  if (!config.WEB_PUSH_VAPID_PUBLIC_KEY !== !config.WEB_PUSH_VAPID_PRIVATE_KEY) {
    throw new Error(
      'WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY are set together, or not at all.',
    );
  }
  if (config.TELEPHONY_DRIVER === 'twilio') {
    const missing = (
      ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TELEPHONY_WEBHOOK_BASE_URL'] as const
    ).filter((key) => !config[key]);
    if (missing.length > 0) {
      throw new Error(`${missing.join(', ')} required when TELEPHONY_DRIVER=twilio.`);
    }
  }
  if (config.PUSH_DRIVER === 'fcm' && !config.FCM_SERVICE_ACCOUNT_JSON) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is required when PUSH_DRIVER=fcm.');
  }
  if (config.MAPS_DRIVER === 'google' && !config.MAPS_API_KEY) {
    throw new Error('MAPS_API_KEY is required when MAPS_DRIVER=google.');
  }
  if (config.MAPS_DRIVER === 'osm' && !config.MAPS_CONTACT) {
    throw new Error('MAPS_CONTACT is required when MAPS_DRIVER=osm.');
  }
  if (config.STORAGE_DRIVER === 's3' && !config.STORAGE_BUCKET) {
    throw new Error('STORAGE_BUCKET is required when STORAGE_DRIVER=s3.');
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
