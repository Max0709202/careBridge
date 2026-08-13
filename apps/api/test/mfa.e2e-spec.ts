import { TestHarness, errorOf } from './support/harness';
import { authed, registerUser, uniqueEmail } from './support/factories';
import { base32Decode, generateTotp } from '../src/domain/totp';

/**
 * The full TOTP lifecycle, against a real application.
 *
 * `src/domain/totp.spec.ts` proves the algorithm against the RFC 6238 vectors.
 * What it cannot prove is the part that actually protects an account: that
 * enrolment is inert until confirmed, that the secret survives a round trip
 * through AES-256-GCM in the database, that a code is *required* at sign-in
 * afterwards, and that a recovery code works exactly once.
 *
 * Those are properties of the wiring, so they are tested through the wiring.
 */
describe('two-factor authentication', () => {
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

  /** The code an authenticator app would be showing right now. */
  function currentCode(secretBase32: string): string {
    return generateTotp(base32Decode(secretBase32), Date.now());
  }

  async function enrol(token: string) {
    const response = await authed(harness, token)
      .post('/api/v1/auth/mfa/enrol')
      .expect(201);

    return response.body as {
      otpauthUri: string;
      secretBase32: string;
      recoveryCodes: string[];
    };
  }

  // ─── enrolment ──────────────────────────────────────────────────────────

  it('returns a scannable secret and one set of recovery codes', async () => {
    const user = await registerUser(harness);
    const enrolment = await enrol(user.accessToken);

    expect(enrolment.otpauthUri).toMatch(/^otpauth:\/\/totp\/CareBridge%3A/);
    expect(enrolment.otpauthUri).toContain(`secret=${enrolment.secretBase32}`);
    expect(enrolment.recoveryCodes).toHaveLength(10);
    expect(enrolment.recoveryCodes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });

  it('is inert until a code confirms it', async () => {
    // Marking MFA active when the QR code is displayed locks out anyone whose
    // authenticator failed to scan it — with no second factor to recover with,
    // by definition.
    const user = await registerUser(harness);
    await enrol(user.accessToken);

    const status = await authed(harness, user.accessToken)
      .get('/api/v1/auth/mfa')
      .expect(200);
    expect((status.body as { enrolled: boolean }).enrolled).toBe(false);

    // And sign-in still works with no code at all.
    await harness.http
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
  });

  it('confirms with a generated code and reports itself enrolled', async () => {
    const user = await registerUser(harness);
    const enrolment = await enrol(user.accessToken);

    await authed(harness, user.accessToken)
      .post('/api/v1/auth/mfa/confirm')
      .send({ code: currentCode(enrolment.secretBase32) })
      .expect(204);

    const status = await authed(harness, user.accessToken)
      .get('/api/v1/auth/mfa')
      .expect(200);

    expect(status.body).toMatchObject({
      enrolled: true,
      recoveryCodesRemaining: 10,
    });
    expect((status.body as { confirmedAt: string }).confirmedAt).toEqual(
      expect.any(String),
    );
  });

  it('refuses to confirm with a wrong code', async () => {
    const user = await registerUser(harness);
    await enrol(user.accessToken);

    const response = await authed(harness, user.accessToken)
      .post('/api/v1/auth/mfa/confirm')
      .send({ code: '000000' })
      .expect(400);

    expect(errorOf(response).message).toMatch(/not right/i);
  });

  it('stores the secret encrypted, never in the clear', async () => {
    // A dump that hands over working second factors is worse than no second
    // factor, because the user believes they have one.
    const user = await registerUser(harness);
    const enrolment = await enrol(user.accessToken);

    const stored = await harness.prisma.userMfa.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    const rawSecret = base32Decode(enrolment.secretBase32);
    expect(Buffer.from(stored.secretCiphertext)).not.toEqual(rawSecret);
    expect(Buffer.from(stored.secretCiphertext).includes(rawSecret)).toBe(false);
    expect(stored.secretIv).toHaveLength(12);
    expect(stored.secretAuthTag).toHaveLength(16);
  });

  it('stores recovery codes only as digests', async () => {
    // Support cannot read them back, which is the point — a recoverable
    // recovery code is a social-engineering path.
    const user = await registerUser(harness);
    const enrolment = await enrol(user.accessToken);

    const stored = await harness.prisma.userMfa.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    for (const code of enrolment.recoveryCodes) {
      expect(stored.recoveryCodeHashes).not.toContain(code);
    }
    expect(stored.recoveryCodeHashes).toHaveLength(10);
  });

  it('will not silently replace a confirmed enrolment', async () => {
    // Anyone with a live session could otherwise swap out the second factor
    // without proving they hold the current one.
    const user = await registerUser(harness);
    const enrolment = await enrol(user.accessToken);
    await authed(harness, user.accessToken)
      .post('/api/v1/auth/mfa/confirm')
      .send({ code: currentCode(enrolment.secretBase32) })
      .expect(204);

    const response = await authed(harness, user.accessToken)
      .post('/api/v1/auth/mfa/enrol')
      .expect(409);

    expect(errorOf(response).message).toMatch(/already on/i);
  });

  // ─── sign-in with a second factor ───────────────────────────────────────

  describe('once confirmed', () => {
    let user: Awaited<ReturnType<typeof registerUser>>;
    let secretBase32: string;
    let recoveryCodes: string[];

    beforeEach(async () => {
      user = await registerUser(harness, { email: uniqueEmail('mfa') });
      const enrolment = await enrol(user.accessToken);
      secretBase32 = enrolment.secretBase32;
      recoveryCodes = enrolment.recoveryCodes;

      await authed(harness, user.accessToken)
        .post('/api/v1/auth/mfa/confirm')
        .send({ code: currentCode(secretBase32) })
        .expect(204);
    });

    it('demands a code, and says so without confirming the password was right', async () => {
      const response = await harness.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(400);

      expect(errorOf(response).field).toBe('mfaCode');
    });

    it('accepts the current code', async () => {
      await harness.http
        .post('/api/v1/auth/login')
        .send({
          email: user.email,
          password: user.password,
          mfaCode: currentCode(secretBase32),
        })
        .expect(200);
    });

    it('rejects a wrong code even with the right password', async () => {
      await harness.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password, mfaCode: '000000' })
        .expect(400);
    });

    it('rejects a correct code with the wrong password', async () => {
      // The factors are checked in order, and the password failure must look
      // exactly like any other password failure — an attacker holding a stolen
      // code must not learn that the account exists and has MFA.
      const response = await harness.http
        .post('/api/v1/auth/login')
        .send({
          email: user.email,
          password: 'not-the-password',
          mfaCode: currentCode(secretBase32),
        })
        .expect(401);

      expect(errorOf(response).code).toBe('authentication');
    });

    it('accepts a recovery code, once', async () => {
      const code = recoveryCodes[0]!;

      await harness.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password, mfaCode: code })
        .expect(200);

      // Spent. The same code must not open the door twice.
      await harness.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password, mfaCode: code })
        .expect(400);

      const status = await authed(harness, user.accessToken)
        .get('/api/v1/auth/mfa')
        .expect(200);
      expect(
        (status.body as { recoveryCodesRemaining: number }).recoveryCodesRemaining,
      ).toBe(9);
    });

    it('tolerates a phone clock one step out', async () => {
      // Zero tolerance turns a slightly wrong clock into a support ticket.
      const { generateTotp: gen } = await import('../src/domain/totp');
      const oneStepAgo = gen(base32Decode(secretBase32), Date.now() - 30_000);

      await harness.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password, mfaCode: oneStepAgo })
        .expect(200);
    });

    it('turns off, and sign-in stops asking', async () => {
      await authed(harness, user.accessToken).delete('/api/v1/auth/mfa').expect(204);

      await harness.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
    });

    it('records enrolment and removal in the audit log', async () => {
      await authed(harness, user.accessToken).delete('/api/v1/auth/mfa').expect(204);

      const actions = (
        await harness.prisma.auditLog.findMany({
          where: { actorUserId: user.userId, entityType: 'UserMfa' },
          orderBy: { at: 'asc' },
        })
      ).map((row) => row.action);

      expect(actions).toEqual([
        'auth.mfa.enrolment_started',
        'auth.mfa.enabled',
        'auth.mfa.disabled',
      ]);
    });
  });
});
