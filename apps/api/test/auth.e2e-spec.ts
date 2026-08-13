import { TestHarness, errorOf } from './support/harness';
import { authed, registerUser, signIn, uniqueEmail } from './support/factories';
import { expectsAuthentication, expectsSingleUse } from './support/negative-paths';

/**
 * The auth lifecycle, end to end.
 *
 * These run against a real application and a real database because almost
 * everything worth checking here is a property of the wiring rather than of a
 * function: that the global guard is actually registered, that a reset really
 * does revoke sessions, that two failure modes really do return identical
 * bytes.
 */
describe('auth', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  // ─── registration and verification ──────────────────────────────────────

  it('registers, signs in, and returns an empty snapshot', async () => {
    const email = uniqueEmail();
    const response = await harness.http
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Ada Okonkwo',
        email,
        password: 'correct-horse-battery-staple',
        acceptedTerms: true,
      })
      .expect(201);

    const body = response.body as {
      accessToken: string;
      state: { patients: unknown[]; user: { email: string } };
    };

    expect(body.accessToken).toEqual(expect.any(String));
    // Genuinely empty: the first-run experience should be the one a real user
    // gets, not a seeded one.
    expect(body.state.patients).toEqual([]);
    expect(body.state.user.email).toBe(email.toLowerCase());
  });

  it('records consent as an explicit act rather than inferring it', async () => {
    const user = await registerUser(harness);

    const consents = await harness.prisma.userConsent.findMany({
      where: { userId: user.userId },
    });
    expect(consents.map((c) => c.type).sort()).toEqual(['privacy', 'terms']);
  });

  it('will not register the same address twice', async () => {
    const email = uniqueEmail();
    await registerUser(harness, { email });

    const response = await harness.http
      .post('/api/v1/auth/register')
      .send({ fullName: 'Someone Else', email, password: 'a-different-password' })
      .expect(409);

    expect(errorOf(response).code).toBe('conflict');
  });

  it('verifies an address using the link in the email it sent', async () => {
    // Read from the email rather than the token table, so a template that
    // builds a broken URL fails here instead of failing a customer.
    const user = await registerUser(harness);
    const token = harness.mail.tokenFor(user.email);

    await harness.http.post('/api/v1/auth/verify-email').send({ token }).expect(204);

    const stored = await harness.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
    });
    expect(stored.emailVerifiedAt).not.toBeNull();
  });

  it('lets a verification token be used exactly once', async () => {
    const user = await registerUser(harness);
    const token = harness.mail.tokenFor(user.email);

    await expectsSingleUse({
      redeem: () => harness.http.post('/api/v1/auth/verify-email').send({ token }),
    });
  });

  it('invalidates the previous verification token when one is resent', async () => {
    // Three "resend" taps must not leave three live links in three inboxes.
    const user = await registerUser(harness);
    const first = harness.mail.tokenFor(user.email);

    await harness.http
      .post('/api/v1/auth/resend-verification')
      .send({ email: user.email })
      .expect(202);

    const second = harness.mail.tokenFor(user.email);
    expect(second).not.toBe(first);

    await harness.http
      .post('/api/v1/auth/verify-email')
      .send({ token: first })
      .expect(400);

    await harness.http
      .post('/api/v1/auth/verify-email')
      .send({ token: second })
      .expect(204);
  });

  it('accepts a resend for an unknown address without saying so', async () => {
    // Whether an address has an account is a fact about a person that an
    // unauthenticated caller does not get to read.
    await harness.http
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'nobody@example.test' })
      .expect(202);

    expect(harness.mail.sent).toHaveLength(0);
  });

  // ─── sign-in ────────────────────────────────────────────────────────────

  it('gives the same answer for a wrong password and an unknown account', async () => {
    // Otherwise the error is a way to enumerate the customer list — which for
    // this product is a list of people with a vulnerable relative.
    const user = await registerUser(harness);

    const wrongPassword = await harness.http
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not-the-right-password' })
      .expect(401);

    const unknownAccount = await harness.http
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'not-the-right-password' })
      .expect(401);

    expect(errorOf(wrongPassword).message).toBe(errorOf(unknownAccount).message);
    expect(errorOf(wrongPassword).code).toBe(errorOf(unknownAccount).code);
  });

  it('protects every non-public endpoint by default', async () => {
    // The global guard means protection is the default and a route has to ask
    // to be public. This is the test that notices when one does by accident.
    await expectsAuthentication(() => harness.http.get('/api/v1/care/state').send());
    await expectsAuthentication(() => harness.http.get('/api/v1/auth/sessions').send());
    await expectsAuthentication(() => harness.http.get('/api/v1/me/devices').send());
  });

  // ─── refresh rotation ───────────────────────────────────────────────────

  it('rotates a refresh token and refuses the old one', async () => {
    const user = await registerUser(harness);

    const rotated = await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    const next = (rotated.body as { refreshToken: string }).refreshToken;
    expect(next).not.toBe(user.refreshToken);

    await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    // Two parties hold tokens from one login and we cannot tell which is
    // legitimate, so both are forced to sign in again.
    const user = await registerUser(harness);

    const rotated = await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);
    const live = (rotated.body as { refreshToken: string }).refreshToken;

    await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    // The token that *was* legitimate is now dead too. That is the point.
    await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: live })
      .expect(401);

    const revoked = await harness.prisma.refreshToken.findMany({
      where: { userId: user.userId, revokedReason: 'reuse_detected' },
    });
    expect(revoked.length).toBeGreaterThan(0);
  });

  // ─── sessions ───────────────────────────────────────────────────────────

  it('lists one row per sign-in, not one per token', async () => {
    const user = await registerUser(harness);
    await signIn(harness, user);
    await signIn(harness, user);

    // Rotating must not add a row: a person would see twelve entries for one
    // phone and no way to tell which to revoke.
    await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    const response = await authed(harness, user.accessToken)
      .get('/api/v1/auth/sessions')
      .expect(200);

    const sessions = response.body as Array<{ id: string; isCurrent: boolean }>;
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.isCurrent)).toHaveLength(1);
  });

  it('revokes one session without touching the others', async () => {
    const user = await registerUser(harness);
    const other = await signIn(harness, user);

    const listed = await authed(harness, user.accessToken)
      .get('/api/v1/auth/sessions')
      .expect(200);

    const sessions = listed.body as Array<{ id: string; isCurrent: boolean }>;
    const target = sessions.find((s) => !s.isCurrent);
    expect(target).toBeDefined();

    await authed(harness, user.accessToken)
      .delete(`/api/v1/auth/sessions/${target!.id}`)
      .expect(204);

    await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: other.refreshToken })
      .expect(401);

    // The caller's own session still works.
    await authed(harness, user.accessToken).get('/api/v1/care/state').expect(200);
  });

  it('will not let one account revoke another account’s session', async () => {
    const victim = await registerUser(harness);
    const attacker = await registerUser(harness);

    const listed = await authed(harness, victim.accessToken)
      .get('/api/v1/auth/sessions')
      .expect(200);
    const victimSession = (listed.body as Array<{ id: string }>)[0];

    await authed(harness, attacker.accessToken)
      .delete(`/api/v1/auth/sessions/${victimSession!.id}`)
      .expect(404);

    await authed(harness, victim.accessToken).get('/api/v1/care/state').expect(200);
  });

  it('kills access tokens immediately on sign-out-everywhere', async () => {
    // Revoking refresh tokens alone would leave an already-issued access token
    // working for up to fifteen minutes. Raising the token version is what
    // makes "everywhere" mean it.
    const user = await registerUser(harness);

    await authed(harness, user.accessToken).get('/api/v1/care/state').expect(200);
    await authed(harness, user.accessToken).post('/api/v1/auth/logout-all').expect(204);
    await authed(harness, user.accessToken).get('/api/v1/care/state').expect(401);
  });

  // ─── password reset ─────────────────────────────────────────────────────

  it('accepts a reset request for an unknown address without saying so', async () => {
    await harness.http
      .post('/api/v1/auth/password-reset')
      .send({ email: 'nobody@example.test' })
      .expect(202);

    expect(harness.mail.sent).toHaveLength(0);
  });

  it('resets a password, revokes every session, and says so by email', async () => {
    const user = await registerUser(harness);
    harness.mail.clear();

    await harness.http
      .post('/api/v1/auth/password-reset')
      .send({ email: user.email })
      .expect(202);

    const token = harness.mail.tokenFor(user.email);

    await harness.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: 'a-brand-new-passphrase' })
      .expect(204);

    // The old session is gone — otherwise an attacker who already had one
    // keeps a foothold the new password does not dislodge.
    await authed(harness, user.accessToken).get('/api/v1/care/state').expect(401);
    await harness.http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    await signIn(harness, { email: user.email, password: 'a-brand-new-passphrase' });

    // The notification that turns a silent takeover into a noticed one.
    const notice = harness.mail.lastTo(user.email);
    expect(notice?.subject).toMatch(/password was changed/i);
  });

  it('lets a reset token be used exactly once', async () => {
    const user = await registerUser(harness);
    harness.mail.clear();

    await harness.http
      .post('/api/v1/auth/password-reset')
      .send({ email: user.email })
      .expect(202);
    const token = harness.mail.tokenFor(user.email);

    await expectsSingleUse({
      redeem: () =>
        harness.http
          .post('/api/v1/auth/password-reset/confirm')
          .send({ token, newPassword: 'yet-another-passphrase' }),
    });
  });

  it('refuses an expired reset token', async () => {
    const user = await registerUser(harness);
    harness.mail.clear();

    await harness.http
      .post('/api/v1/auth/password-reset')
      .send({ email: user.email })
      .expect(202);
    const token = harness.mail.tokenFor(user.email);

    await harness.prisma.credentialToken.updateMany({
      where: { userId: user.userId, type: 'passwordReset' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await harness.http
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, newPassword: 'a-brand-new-passphrase' })
      .expect(400);

    // Expired, already used and never existed are one message, so a caller
    // holding a guessed token learns nothing about how close it was.
    expect(errorOf(response).message).toMatch(/no longer valid/i);
  });

  // ─── MFA scaffolding ────────────────────────────────────────────────────

  // The full lifecycle — enrol, confirm, sign in with a code, spend a recovery
  // code — lives in mfa.e2e-spec.ts. The refusal when no encryption key is
  // configured is a decision taken before any I/O, so it is unit-tested in
  // src/modules/auth/mfa.spec.ts where the key can actually be absent.

  it('reports two-factor as off for an account that has not enrolled', async () => {
    const user = await registerUser(harness);

    const response = await authed(harness, user.accessToken)
      .get('/api/v1/auth/mfa')
      .expect(200);

    expect(response.body).toEqual({
      enrolled: false,
      confirmedAt: null,
      recoveryCodesRemaining: 0,
    });
  });
});
