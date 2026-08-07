import { loadConfig } from './config';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
};

describe('configuration', () => {
  it('fails loudly rather than starting with a missing database URL', () => {
    expect(() => loadConfig({ JWT_SECRET: valid.JWT_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('has no default JWT secret', () => {
    // A default signing key is a backdoor that ships to production exactly
    // once and is never noticed.
    expect(() => loadConfig({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects a JWT secret short enough to brute-force', () => {
    expect(() =>
      loadConfig({ ...valid, JWT_SECRET: 'too-short' }),
    ).toThrow(/at least 32/);
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
      ...valid,
      NODE_ENV: 'production',
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
});
