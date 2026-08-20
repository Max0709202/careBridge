import { loadConfig } from './config';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
};

/**
 * A production environment that is *otherwise* complete, so a test about one
 * production rule fails for that rule and not for an unrelated missing value.
 */
const productionReady = {
  ...valid,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://app.example.com',
  REDIS_URL: 'redis://cache.internal:6379',
  MAIL_DRIVER: 'smtp',
  PUSH_DRIVER: 'fcm',
  FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}',
  MAPS_DRIVER: 'google',
  MAPS_API_KEY: 'k',
  PAYMENTS_DRIVER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_live_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
};

describe('configuration', () => {
  it('fails loudly rather than starting with a missing database URL', () => {
    expect(() => loadConfig({ JWT_SECRET: valid.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('has no default JWT secret', () => {
    // A default signing key is a backdoor that ships to production exactly
    // once and is never noticed.
    expect(() => loadConfig({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects a JWT secret short enough to brute-force', () => {
    expect(() => loadConfig({ ...valid, JWT_SECRET: 'too-short' })).toThrow(
      /at least 32/,
    );
  });

  it('refuses a wildcard CORS origin in production', () => {
    expect(() =>
      loadConfig({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: '*' }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('allows a wildcard outside production, where it is a convenience', () => {
    const config = loadConfig({ ...valid, CORS_ORIGINS: '*' });
    expect(config.corsOrigins).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it('parses an origin allowlist', () => {
    const config = loadConfig({
      ...productionReady,
      CORS_ORIGINS: 'https://app.example.com, https://ops.example.com',
    });
    expect(config.corsOrigins).toEqual([
      'https://app.example.com',
      'https://ops.example.com',
    ]);
  });

  it('keeps access tokens short-lived by default', () => {
    // Revocation is immediate because the window is small; a long-lived access
    // token would outlive a revoked grant.
    const config = loadConfig(valid);
    expect(config.ACCESS_TOKEN_TTL_MINUTES).toBeLessThanOrEqual(15);
    expect(config.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it('coerces numeric environment values, which arrive as strings', () => {
    const config = loadConfig({ ...valid, PORT: '8080' });
    expect(config.PORT).toBe(8080);
  });

  // ─── the adapters ───────────────────────────────────────────────────────

  it('refuses the log-only adapters in production', () => {
    // Each of these succeeds while doing nothing, which is the failure mode
    // hardest to notice: password resets that never arrive look exactly like
    // nobody asking for one.
    expect(() => loadConfig({ ...productionReady, MAIL_DRIVER: 'log' })).toThrow(
      /MAIL_DRIVER=log/,
    );

    expect(() =>
      loadConfig({ ...productionReady, MAPS_DRIVER: 'deterministic' }),
    ).toThrow(/MAPS_DRIVER=deterministic/);

    // The most consequential of the four. An adapter that reports every charge
    // as settled is a system that bills nobody and says everything is fine.
    expect(() =>
      loadConfig({
        ...productionReady,
        PAYMENTS_DRIVER: 'local',
        STRIPE_SECRET_KEY: undefined,
        STRIPE_WEBHOOK_SECRET: undefined,
      }),
    ).toThrow(/PAYMENTS_DRIVER=local/);
  });

  it('requires Redis in production, where the in-process fallback is wrong', () => {
    const { REDIS_URL: _dropped, ...withoutRedis } = productionReady;
    expect(() => loadConfig(withoutRedis)).toThrow(/REDIS_URL/);
  });

  it('allows the in-process fallback locally', () => {
    expect(loadConfig(valid).REDIS_URL).toBeUndefined();
  });

  it('demands the credential a chosen adapter cannot work without', () => {
    expect(() => loadConfig({ ...valid, MAPS_DRIVER: 'google' })).toThrow(
      /MAPS_API_KEY/,
    );

    expect(() => loadConfig({ ...valid, PUSH_DRIVER: 'fcm' })).toThrow(
      /FCM_SERVICE_ACCOUNT_JSON/,
    );

    expect(() => loadConfig({ ...valid, PAYMENTS_DRIVER: 'stripe' })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
  });

  it('refuses Stripe without the secret that verifies its webhooks', () => {
    // Without it a "payment succeeded" callback cannot be told from an
    // unauthenticated request marking an invoice paid, and the endpoint is
    // public by necessity. Refused at boot rather than degraded to trust.
    expect(() =>
      loadConfig({
        ...valid,
        PAYMENTS_DRIVER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
      }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  // ─── MFA key ────────────────────────────────────────────────────────────

  it('rejects an MFA key that is not 32 bytes rather than stretching it', () => {
    // Padding a short key silently would produce a system that encrypts,
    // passes every test, and has a fraction of the key space its name implies.
    expect(() =>
      loadConfig({ ...valid, MFA_SECRET_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 bytes/);
  });

  it('treats a missing MFA key as "enrolment disabled", not as an error', () => {
    expect(loadConfig(valid).mfaSecretKey).toBeNull();
    expect(
      loadConfig({ ...valid, MFA_SECRET_KEY: Buffer.alloc(32).toString('base64') })
        .mfaSecretKey,
    ).toHaveLength(32);
  });

  // ─── reminder offsets ───────────────────────────────────────────────────

  it('parses reminder offsets, de-duplicated and earliest first', () => {
    const config = loadConfig({
      ...valid,
      APPOINTMENT_REMINDER_OFFSETS: '120, 1440, 120, 60',
    });
    expect(config.APPOINTMENT_REMINDER_OFFSETS).toEqual([1440, 120, 60]);
  });

  it('rejects a reminder offset that is not a positive whole number', () => {
    expect(() =>
      loadConfig({ ...valid, APPOINTMENT_REMINDER_OFFSETS: '60,-30' }),
    ).toThrow(/APPOINTMENT_REMINDER_OFFSETS/);

    expect(() =>
      loadConfig({ ...valid, APPOINTMENT_REMINDER_OFFSETS: 'soon' }),
    ).toThrow(/APPOINTMENT_REMINDER_OFFSETS/);
  });
});
