import { z } from 'zod';

/**
 * Environment, validated once at boot.
 *
 * Direct `process.env` reads are banned everywhere else: a typo in an env name
 * silently becomes `undefined` at the call site and surfaces as a runtime bug
 * hours later. Here it fails the container's first second, loudly.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Signing key for access tokens. Must be supplied — there is deliberately no
   * default, because a default JWT secret is a backdoor that ships to
   * production exactly once and is never noticed.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  /** Short by design. Revocation is immediate because the window is small. */
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * Comma-separated allowlist. `*` is accepted only outside production, so a
   * permissive local setting cannot leak into a deployed environment.
   */
  CORS_ORIGINS: z.string().default('*'),

  /** Failed sign-ins per email+IP per window before lockout. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
});

export type AppConfig = z.infer<typeof schema> & {
  corsOrigins: string[] | true;
  isProduction: boolean;
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

  return {
    ...config,
    isProduction,
    corsOrigins: origins.includes('*') ? true : origins,
  };
}
