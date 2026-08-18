import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';

import { RateLimitGuard, type RateLimitPolicyName } from './rate-limit.guard';
import { RateLimitError } from './errors';
import { InProcessRateLimitAdapter } from '../infrastructure/rate-limit/adapters/in-process-rate-limit.adapter';
import type { AppConfig } from './config';

describe('RateLimitGuard', () => {
  const config = {
    LOGIN_WINDOW_MINUTES: 15,
    SIGN_IN_IP_MAX_ATTEMPTS: 3,
    EMAIL_DISPATCH_MAX_ATTEMPTS: 2,
    EMAIL_DISPATCH_WINDOW_MINUTES: 60,
    TOKEN_GUESS_MAX_ATTEMPTS: 2,
    TOKEN_GUESS_WINDOW_MINUTES: 15,
  } as unknown as AppConfig;

  const contextFor = (
    policy: RateLimitPolicyName | undefined,
    request: { ip?: string; body?: unknown },
  ): ExecutionContext =>
    ({
      getHandler: () => policy,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  /** The real Reflector reads decorator metadata; here the handler *is* the policy. */
  const reflector = {
    getAllAndOverride: (_key: string, targets: unknown[]) => targets[0],
  } as unknown as Reflector;

  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard(reflector, new InProcessRateLimitAdapter(), config);
  });

  it('does not limit a route that did not ask to be limited', async () => {
    const context = contextFor(undefined, { ip: '10.0.0.1' });
    for (let i = 0; i < 50; i += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  });

  it('refuses past the limit, with a Retry-After a client can act on', async () => {
    const context = contextFor('tokenGuess', { ip: '10.0.0.1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });

    const error = await guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('says nothing about which limit was hit', async () => {
    // "Too many attempts for that email address" would confirm the address
    // exists, which every other response on these routes refuses to do.
    const context = contextFor('emailDispatch', {
      ip: '10.0.0.1',
      body: { email: 'someone@example.com' },
    });
    await guard.canActivate(context);
    await guard.canActivate(context);

    const error = (await guard.canActivate(context).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('Too many attempts. Please wait and try again.');
    expect(error.message).not.toContain('example.com');
  });

  it('counts one host across many addresses', async () => {
    // Per-address counting alone would let one machine mail a thousand
    // different people, five messages each.
    const from = (email: string) =>
      contextFor('emailDispatch', { ip: '10.0.0.1', body: { email } });

    await guard.canActivate(from('a@example.com'));
    await guard.canActivate(from('b@example.com'));

    await expect(guard.canActivate(from('c@example.com'))).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('counts many hosts against one address', async () => {
    // And per-IP counting alone would let a botnet mail one person from a
    // thousand machines.
    const at = (ip: string) =>
      contextFor('emailDispatch', { ip, body: { email: 'victim@example.com' } });

    await guard.canActivate(at('10.0.0.1'));
    await guard.canActivate(at('10.0.0.2'));

    await expect(guard.canActivate(at('10.0.0.3'))).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('keeps one policy from spending another policy allowance', async () => {
    const ip = '10.0.0.1';
    await guard.canActivate(contextFor('tokenGuess', { ip }));
    await guard.canActivate(contextFor('tokenGuess', { ip }));
    await expect(
      guard.canActivate(contextFor('tokenGuess', { ip })),
    ).rejects.toBeInstanceOf(RateLimitError);

    // Exhausting the reset-token guesses must not also lock this address out
    // of signing in.
    await expect(guard.canActivate(contextFor('signIn', { ip }))).resolves.toBe(true);
  });

  it('ignores a body that is not carrying a usable address', async () => {
    // The body is attacker-controlled. A number, a missing field or a 10kB
    // string must not become part of a key.
    const cases: unknown[] = [
      undefined,
      null,
      'a string body',
      { email: 42 },
      { email: '   ' },
      { email: `${'a'.repeat(300)}@example.com` },
    ];

    // A distinct IP per case, so what is being checked is that the body
    // contributed no key of its own rather than that the IP limit is generous.
    for (const [index, body] of cases.entries()) {
      const context = contextFor('emailDispatch', { ip: `10.0.1.${index}`, body });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      await expect(guard.canActivate(context)).resolves.toBe(true);

      // Two attempts is the whole emailDispatch allowance for that IP. If the
      // body had produced an address key, the second would have been the first
      // attempt against it and this third would still be permitted.
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(RateLimitError);
    }
  });

  it('falls back to a placeholder when the request has no address at all', async () => {
    const context = contextFor('tokenGuess', {});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(RateLimitError);
  });
});
