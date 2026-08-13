import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createPatient,
  registerUser,
  uniqueEmail,
  verifyEmail,
} from './support/factories';
import { expectsAuthentication, expectsSingleUse } from './support/negative-paths';

/**
 * Family invitations — flagged in FOUNDATION §5 as an account-takeover vector.
 *
 * What an invitation grants is standing access to a vulnerable person's home
 * address, appointment schedule and, from Stage 3, their live position. Each
 * test below corresponds to one specific way that goes wrong, so a regression
 * fails a named test rather than being noticed in a breach.
 */
describe('invitations', () => {
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

  /** An organiser with a verified address and one patient. */
  async function organiser() {
    const user = await registerUser(harness);
    await verifyEmail(harness, user.userId);
    const patientId = await createPatient(harness, user.accessToken);
    harness.mail.clear();
    return { ...user, patientId };
  }

  // ─── the happy path ─────────────────────────────────────────────────────

  it('invites, is accepted, and shares the patient', async () => {
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail('sibling');

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({
        email: inviteeEmail,
        relationship: 'son',
        permissions: ['viewProfile', 'scheduleAppointments'],
      })
      .expect(201);

    const token = harness.mail.tokenFor(inviteeEmail);

    const invitee = await registerUser(harness, { email: inviteeEmail });
    await verifyEmail(harness, invitee.userId);

    const accepted = await authed(harness, invitee.accessToken)
      .post('/api/v1/invitations/accept')
      .send({ token })
      .expect(201);

    const state = accepted.body as {
      patients: Array<{ id: string }>;
      access: Record<string, { permissions: string[] }>;
    };

    expect(state.patients.map((p) => p.id)).toContain(inviter.patientId);
    expect(state.access[inviter.patientId]?.permissions.sort()).toEqual([
      'scheduleAppointments',
      'viewProfile',
    ]);
  });

  it('names the inviter, and nothing else, in the email', async () => {
    // The first name is the only way a recipient can tell a genuine invitation
    // from a phishing attempt. The patient is not named, because the recipient
    // has no access to them yet — and may never accept.
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail();

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({
        email: inviteeEmail,
        relationship: 'friend',
        permissions: ['viewProfile'],
      })
      .expect(201);

    const message = harness.mail.lastTo(inviteeEmail);
    expect(message?.text).toContain('Ada');
    expect(message?.text).not.toContain('Margaret');
    expect(message?.text).not.toMatch(/Parkside|Brooklyn|11226/);
  });

  it('masks the invitee address in the list the circle can see', async () => {
    const inviter = await organiser();
    const inviteeEmail = 'adaokonkwo@example.test';

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({
        email: inviteeEmail,
        relationship: 'friend',
        permissions: ['viewProfile'],
      })
      .expect(201);

    const listed = await authed(harness, inviter.accessToken)
      .get(`/api/v1/patients/${inviter.patientId}/invitations`)
      .expect(200);

    const invitations = listed.body as Array<{ emailHint: string; status: string }>;
    expect(invitations[0]?.emailHint).toBe('a•••••••••@example.test');
    expect(invitations[0]?.emailHint).not.toBe(inviteeEmail);
    expect(invitations[0]?.status).toBe('pending');
  });

  // ─── email binding: the property that stops the link being the grant ────

  it('refuses an invitation presented by a different account', async () => {
    // Without this, the link *is* the grant — and links travel through
    // forwarded mail, shared family inboxes and screenshots in group chats.
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail('intended');

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({ email: inviteeEmail, relationship: 'son', permissions: ['viewProfile'] })
      .expect(201);

    const token = harness.mail.tokenFor(inviteeEmail);

    const stranger = await registerUser(harness);
    await verifyEmail(harness, stranger.userId);

    const response = await authed(harness, stranger.accessToken)
      .post('/api/v1/invitations/accept')
      .send({ token })
      .expect(400);

    expect(errorOf(response).message).toMatch(/no longer valid/i);

    const grants = await harness.prisma.patientAccess.findMany({
      where: { userId: stranger.userId },
    });
    expect(grants).toHaveLength(0);
  });

  it('refuses an invitee whose own address is unverified', async () => {
    // Otherwise anyone can register *with* the invited address and accept, and
    // the email binding proves nothing at all.
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail();

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({ email: inviteeEmail, relationship: 'son', permissions: ['viewProfile'] })
      .expect(201);

    const token = harness.mail.tokenFor(inviteeEmail);
    const invitee = await registerUser(harness, { email: inviteeEmail });

    const response = await authed(harness, invitee.accessToken)
      .post('/api/v1/invitations/accept')
      .send({ token })
      .expect(400);

    expect(errorOf(response).message).toMatch(/confirm your email/i);
  });

  it('refuses an inviter whose own address is unverified', async () => {
    // An unverified inviter is an unproven mailbox: somebody could register
    // with a stranger's address and start building a graph of grants from an
    // account they never proved they own.
    const unverified = await registerUser(harness);
    const patientId = await createPatient(harness, unverified.accessToken);

    const response = await authed(harness, unverified.accessToken)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .send({ email: uniqueEmail(), relationship: 'son', permissions: ['viewProfile'] })
      .expect(400);

    expect(errorOf(response).message).toMatch(/confirm your own email/i);
  });

  // ─── single use, expiry, revocation ─────────────────────────────────────

  it('lets an invitation be accepted exactly once', async () => {
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail();

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({ email: inviteeEmail, relationship: 'son', permissions: ['viewProfile'] })
      .expect(201);

    const token = harness.mail.tokenFor(inviteeEmail);
    const invitee = await registerUser(harness, { email: inviteeEmail });
    await verifyEmail(harness, invitee.userId);

    await expectsSingleUse({
      redeem: () =>
        authed(harness, invitee.accessToken)
          .post('/api/v1/invitations/accept')
          .send({ token }),
    });
  });

  it('refuses an expired invitation', async () => {
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail();

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({ email: inviteeEmail, relationship: 'son', permissions: ['viewProfile'] })
      .expect(201);

    const token = harness.mail.tokenFor(inviteeEmail);

    await harness.prisma.patientInvitation.updateMany({
      where: { patientId: inviter.patientId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const invitee = await registerUser(harness, { email: inviteeEmail });
    await verifyEmail(harness, invitee.userId);

    await authed(harness, invitee.accessToken)
      .post('/api/v1/invitations/accept')
      .send({ token })
      .expect(400);
  });

  it('supersedes the previous invitation when one is re-sent', async () => {
    // Three "invite again" taps must not leave three working links.
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail();

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({ email: inviteeEmail, relationship: 'son', permissions: ['viewProfile'] })
      .expect(201);
    const first = harness.mail.tokenFor(inviteeEmail);

    await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({ email: inviteeEmail, relationship: 'son', permissions: ['viewProfile'] })
      .expect(201);
    const second = harness.mail.tokenFor(inviteeEmail);

    expect(second).not.toBe(first);

    const invitee = await registerUser(harness, { email: inviteeEmail });
    await verifyEmail(harness, invitee.userId);

    await authed(harness, invitee.accessToken)
      .post('/api/v1/invitations/accept')
      .send({ token: first })
      .expect(400);

    await authed(harness, invitee.accessToken)
      .post('/api/v1/invitations/accept')
      .send({ token: second })
      .expect(201);
  });

  it('refuses a revoked invitation', async () => {
    const inviter = await organiser();
    const inviteeEmail = uniqueEmail();

    const created = await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({ email: inviteeEmail, relationship: 'son', permissions: ['viewProfile'] })
      .expect(201);

    const token = harness.mail.tokenFor(inviteeEmail);
    const invitationId = (created.body as { id: string }).id;

    await authed(harness, inviter.accessToken)
      .delete(`/api/v1/patients/${inviter.patientId}/invitations/${invitationId}`)
      .expect(204);

    const invitee = await registerUser(harness, { email: inviteeEmail });
    await verifyEmail(harness, invitee.userId);

    await authed(harness, invitee.accessToken)
      .post('/api/v1/invitations/accept')
      .send({ token })
      .expect(400);
  });

  // ─── privilege containment ──────────────────────────────────────────────

  it('will not let someone hand out access they do not hold', async () => {
    // A view-only family member inviting an accomplice as a full manager is
    // privilege escalation with extra steps.
    const inviter = await organiser();
    const helper = await registerUser(harness);
    await verifyEmail(harness, helper.userId);

    await harness.prisma.patientAccess.create({
      data: {
        userId: helper.userId,
        patientId: inviter.patientId,
        relationship: 'friend',
        permissions: ['viewProfile', 'manageAccess'],
        grantedByUserId: inviter.userId,
      },
    });

    const response = await authed(harness, helper.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({
        email: uniqueEmail(),
        relationship: 'other',
        permissions: ['viewProfile', 'makePayments'],
      })
      .expect(400);

    expect(errorOf(response).message).toMatch(/access you already have/i);
  });

  it('requires manageAccess to invite at all', async () => {
    const inviter = await organiser();
    const viewer = await registerUser(harness);
    await verifyEmail(harness, viewer.userId);

    await harness.prisma.patientAccess.create({
      data: {
        userId: viewer.userId,
        patientId: inviter.patientId,
        relationship: 'friend',
        permissions: ['viewProfile'],
        grantedByUserId: inviter.userId,
      },
    });

    await authed(harness, viewer.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({
        email: uniqueEmail(),
        relationship: 'other',
        permissions: ['viewProfile'],
      })
      .expect(404);
  });

  it('insists every grant includes viewProfile', async () => {
    // A grant that can schedule but not see the person is not a coherent thing
    // to offer, and every other permission stands on this one.
    const inviter = await organiser();

    const response = await authed(harness, inviter.accessToken)
      .post(`/api/v1/patients/${inviter.patientId}/invitations`)
      .send({
        email: uniqueEmail(),
        relationship: 'son',
        permissions: ['scheduleAppointments'],
      })
      .expect(400);

    expect(errorOf(response).message).toMatch(/see the patient/i);
  });

  it('gives a stranger the same answer for another family’s patient as for one that does not exist', async () => {
    const inviter = await organiser();
    const stranger = await registerUser(harness);
    await verifyEmail(harness, stranger.userId);

    const forbidden = await authed(harness, stranger.accessToken)
      .get(`/api/v1/patients/${inviter.patientId}/invitations`)
      .expect(404);

    const missing = await authed(harness, stranger.accessToken)
      .get('/api/v1/patients/00000000-0000-4000-8000-000000000000/invitations')
      .expect(404);

    expect(errorOf(forbidden)).toMatchObject({
      code: errorOf(missing).code,
      message: errorOf(missing).message,
    });
  });

  it('protects the invitation endpoints', async () => {
    await expectsAuthentication(() =>
      harness.http.post('/api/v1/invitations/accept').send({ token: 'anything' }),
    );
  });
});
