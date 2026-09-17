import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  createPatient,
  registerUser,
  signIn,
  uniqueEmail,
} from './support/factories';
import { expectsAuthentication } from './support/negative-paths';
import { RetentionService } from '../src/modules/retention/retention.service';
import { deletionExecutesAt } from '../src/domain/account-deletion';
import type { RideStatus } from '../src/domain/ride-status';

/**
 * Account deletion — ADR-0013, against a real database.
 *
 * The unit suite covers the policy: which relation gets which disposition,
 * when a deletion is refused, how the grace period counts. None of that is
 * what goes wrong here. What goes wrong here is **foreign keys**: a cascade
 * nobody looked at taking seven years of invoices with it, a required
 * reference blocking the delete, a column that still spells the person's name
 * out after the row was repointed. Those are properties of Postgres, and no
 * double of Prisma can say anything true about them.
 *
 * So the load-bearing test in this file is the last one: after an erasure,
 * **none of the account's identifiers appears anywhere in the database**,
 * asked of every text column of every table rather than of the tables somebody
 * remembered to check.
 */
describe('account deletion', () => {
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

  /** Runs the sweep the way production does: through RetentionService. */
  const sweep = (now: Date) => harness.app.get(RetentionService).run(now);

  /**
   * A ride in a given state, written directly.
   *
   * The booking flow has its own suite; what these tests need is a row in a
   * particular status, and going through the API to get one would couple this
   * file to pricing and entitlements it is not testing.
   */
  async function createRide(patientId: string, status: RideStatus) {
    const pricing = await harness.prisma.pricingRule.findFirstOrThrow();
    const address = await harness.prisma.address.create({
      data: {
        label: 'Home',
        line1: '1 Test Street',
        city: 'Newark',
        state: 'NJ',
        postalCode: '07101',
      },
    });

    return harness.prisma.ride.create({
      data: {
        patientId,
        pickupAddressId: address.id,
        destinationAddressId: address.id,
        direction: 'outbound',
        status,
        scheduledPickupAt: new Date(),
        distanceMiles: 4.2,
        durationMinutes: 18,
        priceRuleVersion: pricing.version,
        baseCents: pricing.baseFareCents,
        distanceChargeCents: 945,
        timeChargeCents: 810,
        totalCents: 2955,
      },
    });
  }

  // ─── requesting ───────────────────────────────────────────────────────────

  it('schedules a deletion, signs every device out, and exports the account', async () => {
    const user = await registerUser(harness);
    await createPatient(harness, user.accessToken, { preferredName: 'Eleanor' });

    const second = await signIn(harness, user);

    const response = await authed(harness, user.accessToken)
      .delete('/api/v1/auth/account')
      .expect(200);

    expect(response.body.alreadyPending).toBe(false);
    expect(response.body.graceDays).toBe(30);
    expect(new Date(response.body.scheduledFor as string).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // The export is in the response, because after this there is no session
    // left to fetch it with.
    expect(response.body.data.account.email).toBe(user.email);
    expect(response.body.data.care.patients).toHaveLength(1);

    // Step 3: every device, now. Not this one, and not in thirty days.
    await authed(harness, user.accessToken).get('/api/v1/care/state').expect(401);
    await authed(harness, second.accessToken).get('/api/v1/care/state').expect(401);
  });

  it('puts no credential in the export', async () => {
    const user = await registerUser(harness);
    const response = await authed(harness, user.accessToken)
      .delete('/api/v1/auth/account')
      .expect(200);

    const { note, ...payload } = response.body.data;
    const serialised = JSON.stringify(payload);

    expect(note).toMatch(/deliberately excluded/);
    for (const forbidden of [
      'passwordHash',
      'tokenHash',
      'recoveryCode',
      'refreshToken',
      'secret',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('is idempotent — a second confirmation is not a second deletion', async () => {
    // Asserted through the public path, because that is the only route that
    // can reach the idempotent branch at all: the in-app request signs every
    // device out, so there is no session left to retry with, and signing back
    // in would cancel the deletion rather than repeat it.
    const user = await registerUser(harness);

    const linkFor = async () => {
      await harness.http
        .post('/api/v1/auth/account/deletion-request')
        .send({ email: user.email })
        .expect(202);
      const token = /token=([A-Za-z0-9_-]+)/.exec(
        harness.mail.lastTo(user.email)?.text ?? '',
      )?.[1];
      expect(token).toBeDefined();
      return token;
    };

    // Two links, issued before either is spent. Only the newest is valid —
    // `CredentialTokensService.issue` invalidates the outstanding one — so the
    // second request is made with a second link.
    const first = await harness.http
      .post('/api/v1/auth/account/deletion-request/confirm')
      .send({ token: await linkFor() })
      .expect(200);
    expect(first.body.alreadyPending).toBe(false);

    const second = await harness.http
      .post('/api/v1/auth/account/deletion-request/confirm')
      .send({ token: await linkFor() })
      .expect(200);

    expect(second.body.alreadyPending).toBe(true);
    expect(second.body.scheduledFor).toBe(first.body.scheduledFor);

    // One deletion, not two — and the export comes back either way, because
    // the first copy may be the one that got lost.
    expect(second.body.data.account.email).toBe(user.email);
    expect(
      await harness.prisma.auditLog.count({
        where: { action: 'auth.account_deletion_requested' },
      }),
    ).toBe(1);
  });

  it('requires a session', async () => {
    await expectsAuthentication((token) =>
      authed(harness, token).delete('/api/v1/auth/account'),
    );
    await expectsAuthentication((token) =>
      authed(harness, token).get('/api/v1/auth/account/deletion'),
    );
    await expectsAuthentication((token) =>
      authed(harness, token).get('/api/v1/auth/account/export'),
    );
  });

  // ─── refusal ──────────────────────────────────────────────────────────────

  it('refuses while a journey is under way, and says what to do', async () => {
    const user = await registerUser(harness);
    const patientId = await createPatient(harness, user.accessToken);

    await createRide(patientId, 'inProgress');

    const status = await authed(harness, user.accessToken)
      .get('/api/v1/auth/account/deletion')
      .expect(200);
    expect(status.body.blockers).toEqual(['rideInFlight']);
    expect(status.body.blockerMessages[0]).toMatch(/under way/i);

    const refused = await authed(harness, user.accessToken)
      .delete('/api/v1/auth/account')
      .expect(409);
    expect(errorOf(refused).message).toMatch(/under way/i);

    // And nothing was scheduled by the attempt.
    const after = await harness.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
    });
    expect(after.deletionRequestedAt).toBeNull();
    expect(after.deletionScheduledFor).toBeNull();
  });

  // ─── cancelling ───────────────────────────────────────────────────────────

  it('cancels when the account holder signs in again', async () => {
    const user = await registerUser(harness);
    await authed(harness, user.accessToken).delete('/api/v1/auth/account').expect(200);

    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { id: user.userId } }))
        .deletionScheduledFor,
    ).not.toBeNull();

    // The whole undo mechanism: open the app and sign in.
    await signIn(harness, user);

    const after = await harness.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
    });
    expect(after.deletionRequestedAt).toBeNull();
    expect(after.deletionScheduledFor).toBeNull();

    const audited = await harness.prisma.auditLog.findMany({
      where: { actorUserId: user.userId, action: 'auth.account_deletion_cancelled' },
    });
    expect(audited).toHaveLength(1);
  });

  it('does not execute one that was cancelled before its date', async () => {
    const user = await registerUser(harness);
    await authed(harness, user.accessToken).delete('/api/v1/auth/account').expect(200);
    await signIn(harness, user);

    // Well past the date it would have had.
    const results = await sweep(new Date(Date.now() + 40 * 86_400_000));

    expect(results.accountDeletions).toBe(0);
    await expect(
      harness.prisma.user.findUnique({ where: { id: user.userId } }),
    ).resolves.not.toBeNull();
  });

  it('leaves it alone until the grace period has run out', async () => {
    const user = await registerUser(harness);
    const requestedAt = new Date();
    await authed(harness, user.accessToken).delete('/api/v1/auth/account').expect(200);

    const oneDayShort = new Date(
      deletionExecutesAt(requestedAt).getTime() - 86_400_000,
    );
    expect((await sweep(oneDayShort)).accountDeletions).toBe(0);
    await expect(
      harness.prisma.user.findUnique({ where: { id: user.userId } }),
    ).resolves.not.toBeNull();
  });

  // ─── the public path ──────────────────────────────────────────────────────

  it('lets somebody without the app request deletion by email', async () => {
    const user = await registerUser(harness);

    await harness.http
      .post('/api/v1/auth/account/deletion-request')
      .send({ email: user.email })
      .expect(202);

    const message = harness.mail.lastTo(user.email);
    expect(message?.subject).toMatch(/deleted/i);

    const token = /token=([A-Za-z0-9_-]+)/.exec(message?.text ?? '')?.[1];
    expect(token).toBeDefined();

    const confirmed = await harness.http
      .post('/api/v1/auth/account/deletion-request/confirm')
      .send({ token })
      .expect(200);

    expect(confirmed.body.alreadyPending).toBe(false);
    expect(confirmed.body.data.account.email).toBe(user.email);
  });

  it('answers an unknown address exactly as it answers a known one', async () => {
    // Whether an address has an account is a fact about a person who, for this
    // product, has a vulnerable relative — and this endpoint is public.
    const unknown = await harness.http
      .post('/api/v1/auth/account/deletion-request')
      .send({ email: uniqueEmail('nobody') })
      .expect(202);

    const user = await registerUser(harness);
    const known = await harness.http
      .post('/api/v1/auth/account/deletion-request')
      .send({ email: user.email })
      .expect(202);

    expect(unknown.body).toEqual(known.body);
    expect(unknown.status).toBe(known.status);
  });

  it('spends the emailed link once', async () => {
    const user = await registerUser(harness);
    await harness.http
      .post('/api/v1/auth/account/deletion-request')
      .send({ email: user.email })
      .expect(202);

    const token = /token=([A-Za-z0-9_-]+)/.exec(
      harness.mail.lastTo(user.email)?.text ?? '',
    )?.[1];

    await harness.http
      .post('/api/v1/auth/account/deletion-request/confirm')
      .send({ token })
      .expect(200);

    await harness.http
      .post('/api/v1/auth/account/deletion-request/confirm')
      .send({ token })
      .expect(400);
  });

  // ─── execution ────────────────────────────────────────────────────────────

  describe('once the grace period has run out', () => {
    it('erases the person and keeps the record that things happened', async () => {
      const user = await registerUser(harness);
      const patientId = await createPatient(harness, user.accessToken, {
        preferredName: 'Eleanor',
      });

      // Something with evidentiary value: a billing account with an invoice.
      const account = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { ownerUserId: user.userId },
      });
      const invoice = await harness.prisma.invoice.create({
        data: {
          billingAccountId: account.id,
          reason: 'subscriptionPeriod',
          status: 'paid',
          subtotalCents: 2900,
          totalCents: 2900,
          amountPaidCents: 2900,
          lines: [],
          dueAt: new Date(),
          paidAt: new Date(),
        },
      });

      const auditBefore = await harness.prisma.auditLog.count({
        where: { actorUserId: user.userId },
      });
      expect(auditBefore).toBeGreaterThan(0);

      await authed(harness, user.accessToken)
        .delete('/api/v1/auth/account')
        .expect(200);

      const results = await sweep(new Date(Date.now() + 31 * 86_400_000));
      expect(results.accountDeletions).toBe(1);

      // The user row is gone.
      await expect(
        harness.prisma.user.findUnique({ where: { id: user.userId } }),
      ).resolves.toBeNull();

      // The invoice is not. This is the assertion the cascade approach fails:
      // `BillingAccount.ownerUserId` is ON DELETE CASCADE, so deleting the
      // user first would have taken the account and seven years of invoices
      // with it.
      const keptInvoice = await harness.prisma.invoice.findUnique({
        where: { id: invoice.id },
      });
      expect(keptInvoice).not.toBeNull();

      // The billing account survives, repointed at a tombstone, with the
      // address on it overwritten — repointing alone would leave a row that is
      // no longer linked to a person and still spells their address out.
      const keptAccount = await harness.prisma.billingAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(keptAccount.ownerUserId).not.toBeNull();
      expect(keptAccount.ownerUserId).not.toBe(user.userId);
      expect(keptAccount.billingEmail).not.toBe(user.email);

      const tombstone = await harness.prisma.user.findUniqueOrThrow({
        where: { id: keptAccount.ownerUserId! },
      });
      expect(tombstone.isTombstone).toBe(true);
      expect(tombstone.fullName).toBe('Deleted account');
      expect(tombstone.email).toMatch(/@deleted\.invalid$/);

      // Audit rows are reattributed, never dropped. Append-only for seven
      // years, and `actorUserId` has no foreign key — so nothing but this code
      // path could have moved them.
      expect(
        await harness.prisma.auditLog.count({ where: { actorUserId: user.userId } }),
      ).toBe(0);
      expect(
        await harness.prisma.auditLog.count({ where: { actorUserId: tombstone.id } }),
      ).toBeGreaterThanOrEqual(auditBefore);
      expect(
        await harness.prisma.auditLog.count({
          where: { action: 'auth.account_deleted' },
        }),
      ).toBe(1);

      // Credentials are gone outright.
      expect(
        await harness.prisma.refreshToken.count({ where: { userId: user.userId } }),
      ).toBe(0);
      expect(
        await harness.prisma.patientAccess.count({ where: { userId: user.userId } }),
      ).toBe(0);

      // The patient lost their last caregiver: archived, and on their own
      // clock rather than deleted or left orphaned.
      const patient = await harness.prisma.patient.findUniqueOrThrow({
        where: { id: patientId },
      });
      expect(patient.archivedAt).not.toBeNull();
      expect(patient.orphanedAt).not.toBeNull();
      expect(patient.purgedAt).toBeNull();
      // Not yet scrubbed — that is thirty more days.
      expect(patient.preferredName).toBe('Eleanor');
    });

    it('leaves nothing anywhere in the database that identifies the person', async () => {
      // The load-bearing test. Asked of every text column of every table,
      // rather than of the tables somebody remembered to check — so a relation
      // added later without a disposition fails here as well as in the unit
      // suite.
      const email = uniqueEmail('erasure');
      const user = await registerUser(harness, {
        email,
        fullName: 'Wilhelmina Featherstonehaugh',
      });
      await createPatient(harness, user.accessToken, { preferredName: 'Eleanor' });

      await authed(harness, user.accessToken)
        .delete('/api/v1/auth/account')
        .expect(200);
      await sweep(new Date(Date.now() + 31 * 86_400_000));

      const columns = await harness.prisma.$queryRaw<
        Array<{ table_name: string; column_name: string }>
      >`
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN pg_tables t
          ON t.tablename = c.table_name AND t.schemaname = 'public'
        WHERE c.table_schema = 'public'
          AND c.data_type IN ('text', 'character varying')
          AND c.table_name <> '_prisma_migrations'
      `;

      expect(columns.length).toBeGreaterThan(50);

      const found: string[] = [];
      for (const { table_name, column_name } of columns) {
        const hits = await harness.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM "public"."${table_name}"
           WHERE "${column_name}" IN ($1, $2)`,
          email,
          'Wilhelmina Featherstonehaugh',
        );
        if (Number(hits[0]?.n ?? 0) > 0) found.push(`${table_name}.${column_name}`);
      }

      expect(found).toEqual([]);
    });

    it('purges an orphaned patient thirty days after the erasure, without touching the rides', async () => {
      const user = await registerUser(harness);
      const patientId = await createPatient(harness, user.accessToken, {
        preferredName: 'Eleanor',
      });

      const ride = await createRide(patientId, 'completed');

      await authed(harness, user.accessToken)
        .delete('/api/v1/auth/account')
        .expect(200);
      await sweep(new Date(Date.now() + 31 * 86_400_000));

      // Not yet: the patient's own thirty days have not passed.
      expect((await sweep(new Date(Date.now() + 40 * 86_400_000))).patientPurges).toBe(
        0,
      );

      const results = await sweep(new Date(Date.now() + 62 * 86_400_000));
      expect(results.patientPurges).toBe(1);

      const purged = await harness.prisma.patient.findUniqueOrThrow({
        where: { id: patientId },
      });
      expect(purged.preferredName).toBe('Removed');
      expect(purged.phone).toBe('');
      expect(purged.purgedAt).not.toBeNull();

      // And the completed ride is still there. `Ride.patientId` cascades, so a
      // purge that deleted the row would have taken the fare with it — the one
      // thing "delete my account" must not mean.
      await expect(
        harness.prisma.ride.findUnique({ where: { id: ride.id } }),
      ).resolves.not.toBeNull();

      // Idempotent: a second sweep does not purge it again.
      expect((await sweep(new Date(Date.now() + 70 * 86_400_000))).patientPurges).toBe(
        0,
      );
    });

    it('does not orphan a patient somebody else can still reach', async () => {
      const ada = await registerUser(harness);
      const patientId = await createPatient(harness, ada.accessToken);

      // A second caregiver, granted directly — the invitation flow is tested
      // in its own suite.
      const brother = await registerUser(harness);
      await harness.prisma.patientAccess.create({
        data: {
          userId: brother.userId,
          patientId,
          relationship: 'daughter',
          permissions: ['viewProfile', 'scheduleAppointments'],
        },
      });

      await authed(harness, ada.accessToken).delete('/api/v1/auth/account').expect(200);
      await sweep(new Date(Date.now() + 31 * 86_400_000));

      const patient = await harness.prisma.patient.findUniqueOrThrow({
        where: { id: patientId },
      });
      expect(patient.orphanedAt).toBeNull();
      expect(patient.archivedAt).toBeNull();

      // And the brother still sees them.
      const state = await authed(harness, brother.accessToken)
        .get('/api/v1/care/state')
        .expect(200);
      expect(state.body.patients).toHaveLength(1);
    });

    it('cannot be signed in to afterwards, and the tombstone cannot either', async () => {
      const user = await registerUser(harness);
      await authed(harness, user.accessToken)
        .delete('/api/v1/auth/account')
        .expect(200);
      await sweep(new Date(Date.now() + 31 * 86_400_000));

      await harness.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);

      const tombstone = await harness.prisma.user.findFirstOrThrow({
        where: { isTombstone: true },
      });
      await harness.http
        .post('/api/v1/auth/login')
        .send({ email: tombstone.email, password: 'correct-horse-battery-staple' })
        .expect(401);
    });

    it('sends one last message to the address, and then never again', async () => {
      const user = await registerUser(harness);
      await authed(harness, user.accessToken)
        .delete('/api/v1/auth/account')
        .expect(200);

      harness.mail.clear();
      await sweep(new Date(Date.now() + 31 * 86_400_000));

      const final = harness.mail.lastTo(user.email);
      expect(final?.subject).toMatch(/has been deleted/i);
      expect(final?.text).toMatch(/last message/i);
    });

    it('registers the same address again afterwards', async () => {
      // Deletion has to actually free the address, or somebody who leaves and
      // comes back is locked out by a unique constraint on a row that no
      // longer exists.
      const email = uniqueEmail('returning');
      const user = await registerUser(harness, { email });
      await authed(harness, user.accessToken)
        .delete('/api/v1/auth/account')
        .expect(200);
      await sweep(new Date(Date.now() + 31 * 86_400_000));

      await harness.http
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Ada Okonkwo',
          email,
          password: 'correct-horse-battery-staple',
          acceptedTerms: true,
        })
        .expect(201);
    });
  });

  // ─── the export, on its own ───────────────────────────────────────────────

  it('exports without deleting', async () => {
    const user = await registerUser(harness);
    await createPatient(harness, user.accessToken, { preferredName: 'Eleanor' });

    const response = await authed(harness, user.accessToken)
      .get('/api/v1/auth/account/export')
      .expect(200);

    expect(response.body.formatVersion).toBe(1);
    expect(response.body.account.email).toBe(user.email);
    expect(response.body.care.patients).toHaveLength(1);

    // Nothing was scheduled by asking.
    const after = await harness.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
    });
    expect(after.deletionRequestedAt).toBeNull();

    // And the session still works.
    await authed(harness, user.accessToken).get('/api/v1/care/state').expect(200);
  });

  it('reports no pending deletion anywhere a session can see', async () => {
    // ADR-0013 steps 2 and 3 together make a pending deletion unobservable:
    // the request signs every device out, and signing back in cancels it. So
    // there is deliberately nothing on the snapshot or the status endpoint
    // that reports one, and this test is what stops somebody adding a field
    // that could only ever be null.
    const user = await registerUser(harness);

    const status = await authed(harness, user.accessToken)
      .get('/api/v1/auth/account/deletion')
      .expect(200);
    expect(Object.keys(status.body as object).sort()).toEqual([
      'blockerMessages',
      'blockers',
      'graceDays',
    ]);

    const state = await authed(harness, user.accessToken)
      .get('/api/v1/care/state')
      .expect(200);
    expect(state.body.user).not.toHaveProperty('deletionScheduledFor');

    // Requesting, then signing back in, leaves nothing scheduled.
    await authed(harness, user.accessToken).delete('/api/v1/auth/account').expect(200);
    await signIn(harness, user);

    const after = await harness.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
    });
    expect(after.deletionScheduledFor).toBeNull();
  });
});
