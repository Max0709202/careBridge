// Tight limits, set before the harness boots and reads configuration. The rest
// of the suite runs with these effectively disabled (see support/setup.ts):
// every fixture is built over HTTP, so real limits there would refuse the
// setup rather than the behaviour under test.
process.env['LOGIN_MAX_ATTEMPTS'] = '3';
process.env['SIGN_IN_IP_MAX_ATTEMPTS'] = '20';
process.env['EMAIL_DISPATCH_MAX_ATTEMPTS'] = '3';
process.env['EMAIL_DISPATCH_WINDOW_MINUTES'] = '60';
process.env['TOKEN_GUESS_MAX_ATTEMPTS'] = '3';
process.env['TOKEN_GUESS_WINDOW_MINUTES'] = '15';

import { TestHarness, errorOf } from './support/harness';
import { registerUser, uniqueEmail } from './support/factories';

/**
 * The limits on the endpoints an unauthenticated caller can reach.
 *
 * Worth an integration test rather than only a unit one: what is checked here
 * is that the guard is *wired* — registered globally, reading the decorator on
 * the route, and running before the handler does any work. A unit test of the
 * guard proves the counting; only this proves the counting is in the request
 * path, and that the application reads a client address rather than the
 * proxy's.
 *
 * Counters live in the process and are shared by the whole file, so each test
 * acts as its own client. The addresses are from 203.0.113.0/24, which RFC
 * 5737 reserves for documentation and nothing routes.
 */
describe('rate limiting', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
    await harness.clearRateLimitCounters();
  });

  it('refuses a fourth password-reset request and says how long to wait', async () => {
    // The endpoint is a mail sender that accepts any address and answers 202
    // whether or not an account exists. Unlimited, it delivers mail to whoever
    // the caller names, as often as they like.
    const client = '203.0.113.10';
    const email = uniqueEmail('reset-flood');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await harness.http
        .post('/api/v1/auth/password-reset')
        .set('X-Forwarded-For', client)
        .send({ email })
        .expect(202);
    }

    const refused = await harness.http
      .post('/api/v1/auth/password-reset')
      .set('X-Forwarded-For', client)
      .send({ email })
      .expect(429);

    expect(errorOf(refused).code).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keys the limit on the caller, not on the proxy in front of it', async () => {
    // Without `trust proxy`, every request through nginx arrives from the same
    // container address and one person exhausts the allowance for everybody.
    // This is the test that would fail if that were dropped.
    const email = uniqueEmail('neighbour');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await harness.http
        .post('/api/v1/auth/password-reset')
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ email: uniqueEmail('flooder') });
    }

    await harness.http
      .post('/api/v1/auth/password-reset')
      .set('X-Forwarded-For', '203.0.113.21')
      .send({ email })
      .expect(202);
  });

  it('says nothing in a 429 about whether the address has an account', async () => {
    // Everything else on this endpoint is careful not to confirm an account
    // exists. A limit message that named the address, or that differed between
    // a known address and an unknown one, would give that back.
    const known = await registerUser(harness, { clientIp: '203.0.113.30' });
    const unknown = uniqueEmail('never-registered');

    const floodFrom = async (client: string, email: string) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await harness.http
          .post('/api/v1/auth/resend-verification')
          .set('X-Forwarded-For', client)
          .send({ email });
      }
      return harness.http
        .post('/api/v1/auth/resend-verification')
        .set('X-Forwarded-For', client)
        .send({ email })
        .expect(429);
    };

    const knownRefusal = await floodFrom('203.0.113.31', known.email);
    const unknownRefusal = await floodFrom('203.0.113.32', unknown);

    expect(errorOf(knownRefusal).message).toBe(errorOf(unknownRefusal).message);
    expect(errorOf(knownRefusal).message).not.toContain('@');
  });

  it('locks a sign-in out after repeated failures, and forgets them on success', async () => {
    const client = '203.0.113.40';
    const user = await registerUser(harness, { clientIp: client });

    const attempt = (password: string) =>
      harness.http
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', client)
        .send({ email: user.email, password });

    // Only failures count, and a success clears them — so an ordinary person
    // who mistypes twice and then gets it right is never locked out.
    await attempt('not-the-password').expect(401);
    await attempt('not-the-password').expect(401);
    await attempt(user.password).expect(200);

    for (let i = 0; i < 3; i += 1) await attempt('not-the-password').expect(401);

    // Spent — and the correct password no longer gets through either. The
    // lockout is on the pair having run out of attempts, not on this
    // particular guess being wrong.
    const refused = await attempt(user.password).expect(429);
    expect(errorOf(refused).code).toBe('rate_limited');
  });

  it('counts guesses at an invitation token', async () => {
    // An invitation token grants standing access to a vulnerable person's
    // address and daily movements, and any registered account may present one.
    // The only thing between a guesser and a grant is how many guesses they
    // get.
    const client = '203.0.113.50';
    const user = await registerUser(harness, { clientIp: client });

    const guess = (token: string) =>
      harness.http
        .post('/api/v1/invitations/accept')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .set('X-Forwarded-For', client)
        .send({ token });

    for (let i = 0; i < 3; i += 1) {
      const response = await guess(`guess-${i}`);
      expect(response.status).not.toBe(429);
    }

    await guess('guess-4').expect(429);
  });
});
