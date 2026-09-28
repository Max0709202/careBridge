import { describe, expect, it } from 'vitest';

import { CareApi } from '../src/api/careApi';
import { Failure } from '../src/api/failures';
import { InMemoryTokenStore } from '../src/api/tokens';
import { loadSnapshot } from './support/fixture';
import { fakeServer } from './support/fakeServer';

function signedIn() {
  const tokens = new InMemoryTokenStore();
  tokens.write({ accessToken: 'old-access', refreshToken: 'old-refresh' });
  return tokens;
}

const BASE = 'http://localhost/api/v1';

describe('transport', () => {
  it('refreshes once on a 401 and retries with the same Idempotency-Key', async () => {
    let calls = 0;
    const { fetchImpl, requests } = fakeServer({
      'POST /rides': (req) => {
        calls += 1;
        return req.headers.authorization === 'Bearer new-access'
          ? { body: loadSnapshot() }
          : { status: 401, body: { error: { code: 'authentication' } } };
      },
      'POST /auth/refresh': () => ({ body: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresInSeconds: 900 } }),
    });
    const tokens = signedIn();
    const api = new CareApi(tokens, BASE, fetchImpl);

    await api.requestTransport({
      appointmentId: 'a',
      pickupAt: new Date('2026-08-13T10:00:00Z'),
      roundTrip: true,
      notesForDriver: null,
    });

    expect(calls).toBe(2);
    const rides = requests.filter((r) => r.path === '/rides');
    expect(rides[0]!.headers['idempotency-key']).toBeTruthy();
    expect(rides[1]!.headers['idempotency-key']).toBe(rides[0]!.headers['idempotency-key']);
    expect(rides[0]!.body).toEqual({ appointmentId: 'a', pickupAt: '2026-08-13T10:00:00.000Z', roundTrip: true });
    expect(tokens.read()).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('clears the session when the refresh fails, and does not loop', async () => {
    const { fetchImpl, requests } = fakeServer({
      'GET /care/state': () => ({ status: 401, body: {} }),
      'POST /auth/refresh': () => ({ status: 401, body: {} }),
    });
    const tokens = signedIn();
    const api = new CareApi(tokens, BASE, fetchImpl);

    await expect(api.state()).rejects.toMatchObject({ kind: 'authentication' });
    expect(tokens.read()).toBeNull();
    expect(requests.filter((r) => r.path === '/auth/refresh')).toHaveLength(1);
  });

  it('shares one refresh between concurrent 401s, so a single-use token is presented once', async () => {
    const { fetchImpl, requests } = fakeServer({
      'GET /care/state': (req) =>
        req.headers.authorization === 'Bearer new-access' ? { body: loadSnapshot() } : { status: 401, body: {} },
      'POST /auth/refresh': () => ({ body: { accessToken: 'new-access', refreshToken: 'new-refresh' } }),
    });
    const api = new CareApi(signedIn(), BASE, fetchImpl);

    await Promise.all([api.state(), api.state(), api.state()]);
    expect(requests.filter((r) => r.path === '/auth/refresh')).toHaveLength(1);
  });

  it('answers "not found" and "not yours" with the same words', async () => {
    const { fetchImpl } = fakeServer({
      'GET /care/state': () => ({ status: 403, body: {} }),
    });
    const api = new CareApi(signedIn(), BASE, fetchImpl);
    const error = await api.state().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Failure);
    expect((error as Failure).message).toBe('We could not find that, or you do not have access to it.');
  });

  it('carries the field a validation error is about, and Retry-After on a rate limit', async () => {
    const { fetchImpl } = fakeServer({
      'POST /auth/login': () => ({
        status: 400,
        body: { error: { code: 'validation', message: 'Enter the code from your authenticator app.', field: 'mfaCode' } },
      }),
      'POST /auth/password-reset': () => ({
        status: 429,
        body: { error: { code: 'rate_limited' } },
        headers: { 'retry-after': '30' },
      }),
    });
    const api = new CareApi(new InMemoryTokenStore(), BASE, fetchImpl);

    await expect(api.signIn({ email: 'a@b.c', password: 'x' })).rejects.toMatchObject({ field: 'mfaCode' });
    await expect(api.requestPasswordReset('a@b.c')).rejects.toMatchObject({ kind: 'rateLimited', retryAfterSeconds: 30 });
  });

  it('treats an unparseable body on a success as a failure, not as an empty family', async () => {
    const fetchImpl: typeof fetch = async () => new Response('<html>proxy</html>', { status: 200 });
    const api = new CareApi(signedIn(), BASE, fetchImpl);
    await expect(api.state()).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports an HTML 404 from something that is not the API as unreachable, not "not found"', async () => {
    // What another dev server squatting on the API's port answers.
    const fetchImpl: typeof fetch = async () =>
      new Response('<!DOCTYPE html><html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
    const api = new CareApi(new InMemoryTokenStore(), BASE, fetchImpl);
    await expect(api.signIn({ email: 'a@b.c', password: 'x' })).rejects.toMatchObject({
      kind: 'network',
      message: 'We could not reach CareBridge. Check your connection.',
    });
  });

  it('never puts a URL or host in the message for a network error', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('Failed to fetch http://internal-host:3000');
    };
    const api = new CareApi(signedIn(), BASE, fetchImpl);
    const error = (await api.state().catch((e: unknown) => e)) as Failure;
    expect(error.message).toBe('We could not reach CareBridge. Check your connection.');
  });

  it('signs out locally even when the server cannot be reached', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const tokens = signedIn();
    await new CareApi(tokens, BASE, fetchImpl).signOut();
    expect(tokens.read()).toBeNull();
  });

  it('reads an absent billing account as "no plan yet", not an error', async () => {
    const { fetchImpl } = fakeServer({ 'GET /billing/account': () => ({ status: 200, body: undefined }) });
    const api = new CareApi(signedIn(), BASE, fetchImpl);
    expect(await api.billingAccount()).toBeNull();
  });
});
