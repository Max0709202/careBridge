import { AccountDeletionService } from './account-deletion.service';
import { ConflictError, NotFoundError } from '../../common/errors';
import { DELETION_GRACE_DAYS } from '../../domain/account-deletion';

/**
 * Unit tests for the decisions, not for the erasure.
 *
 * The twenty-odd statements that actually repoint and delete rows are asserted
 * by `test/account-deletion.e2e-spec.ts` against a real database, because what
 * they have to be right about is foreign keys and cascade order and no double
 * of Prisma can tell you anything true about those.
 *
 * What is worth pinning here is everything that decides *whether* to erase:
 * refusal, idempotency, the cancel path, and the race between the sweep's scan
 * and its transaction. Those are policy, they are cheap to get wrong, and a
 * fake is a perfectly good witness to them.
 */

/**
 * The doubles are plain object literals rather than a typed `Fake` alias, so
 * TypeScript infers each mock precisely. The lint rules for specs allow
 * poking at an `any`-shaped response body; they do not allow writing `any`,
 * and that is the right line — a double whose shape is `any` stops catching
 * the thing these tests exist to catch, which is a call that no longer matches
 * the service.
 */
function makePrisma() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    patientAccess: {
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    ride: { count: jest.fn() },
    organizationMembership: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    driver: {
      count: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    invoice: { count: jest.fn() },
    userConsent: { findMany: jest.fn(), updateMany: jest.fn() },
    billingAccount: { findUnique: jest.fn(), updateMany: jest.fn() },
    caregiver: { findUnique: jest.fn(), updateMany: jest.fn() },
    refreshToken: { updateMany: jest.fn(), deleteMany: jest.fn() },
    patient: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };

  prisma.user.findUnique.mockResolvedValue({
    id: 'u1',
    email: 'ada@example.com',
    fullName: 'Ada Okonkwo',
    phone: null,
    timeZone: 'America/New_York',
    locale: 'en-US',
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    simplifiedMode: false,
    deletionRequestedAt: null,
    deletionScheduledFor: null,
    isTombstone: false,
  });
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.update.mockResolvedValue({});
  prisma.user.create.mockResolvedValue({});
  prisma.user.delete.mockResolvedValue({});

  prisma.patientAccess.findMany.mockResolvedValue([]);
  prisma.patientAccess.count.mockResolvedValue(0);
  prisma.patientAccess.deleteMany.mockResolvedValue({ count: 0 });

  prisma.ride.count.mockResolvedValue(0);
  prisma.invoice.count.mockResolvedValue(0);

  prisma.organizationMembership.findMany.mockResolvedValue([]);
  prisma.organizationMembership.count.mockResolvedValue(0);
  prisma.organizationMembership.updateMany.mockResolvedValue({ count: 0 });

  prisma.driver.count.mockResolvedValue(0);
  prisma.driver.findFirst.mockResolvedValue(null);
  prisma.driver.updateMany.mockResolvedValue({ count: 0 });
  prisma.driver.update.mockResolvedValue({});

  prisma.userConsent.findMany.mockResolvedValue([]);
  prisma.userConsent.updateMany.mockResolvedValue({ count: 0 });
  prisma.billingAccount.findUnique.mockResolvedValue(null);
  prisma.billingAccount.updateMany.mockResolvedValue({ count: 0 });
  prisma.caregiver.findUnique.mockResolvedValue(null);
  prisma.caregiver.updateMany.mockResolvedValue({ count: 0 });
  prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
  prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
  prisma.patient.findMany.mockResolvedValue([]);

  // The service passes its transaction client straight through, so the double
  // is its own `tx`. That also lets a test assert on one object rather than
  // wiring two.
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => unknown)(prisma)
      : Promise.resolve([]),
  );

  return prisma;
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const care = { snapshot: jest.fn().mockResolvedValue({ patients: [] }) };
  const billing = { recordSeatChange: jest.fn().mockResolvedValue(undefined) };
  const credentials = {
    issue: jest.fn().mockResolvedValue({ token: 't', expiresAt: new Date() }),
    consume: jest.fn().mockResolvedValue({ userId: 'u1', email: 'ada@example.com' }),
  };
  const mail = {
    send: jest.fn().mockResolvedValue({ providerRef: null }),
    driver: 'log' as const,
  };
  const config = {
    PUBLIC_APP_URL: 'http://localhost:8080',
    PASSWORD_RESET_TTL_MINUTES: 30,
  };

  const service = new AccountDeletionService(
    prisma as unknown as ConstructorParameters<typeof AccountDeletionService>[0],
    audit as unknown as ConstructorParameters<typeof AccountDeletionService>[1],
    care as unknown as ConstructorParameters<typeof AccountDeletionService>[2],
    billing as unknown as ConstructorParameters<typeof AccountDeletionService>[3],
    credentials as unknown as ConstructorParameters<typeof AccountDeletionService>[4],
    config as unknown as ConstructorParameters<typeof AccountDeletionService>[5],
    mail as unknown as ConstructorParameters<typeof AccountDeletionService>[6],
  );
  return { service, audit, care, billing, credentials, mail };
}

describe('AccountDeletionService · reading the state', () => {
  it('reports no blockers on a clean account', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    const status = await service.status('u1');

    expect(status.blockers).toEqual([]);
    expect(status.blockerMessages).toEqual([]);
  });

  it('refuses to tell a tombstone anything', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ isTombstone: true });
    const { service } = makeService(prisma);

    await expect(service.status('tomb')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reports a ride in flight, from either side of it', async () => {
    const prisma = makePrisma();
    prisma.ride.count.mockResolvedValue(1);
    const { service } = makeService(prisma);

    const status = await service.status('u1');

    expect(status.blockers).toEqual(['rideInFlight']);
    expect(status.blockerMessages[0]).toMatch(/under way/i);
  });

  it('reports a fleet that would be left with nobody who can manage it', async () => {
    const prisma = makePrisma();
    prisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'org1' },
    ]);
    prisma.organizationMembership.count.mockResolvedValue(0); // no other owners
    prisma.driver.count.mockResolvedValue(4); // still driving
    const { service } = makeService(prisma);

    expect((await service.status('u1')).blockers).toEqual(['lastOrganizationOwner']);
  });

  it('does not block the last owner of an operator that has wound down', async () => {
    // Refusing there would leave the last owner of a dead company permanently
    // unable to delete their own account.
    const prisma = makePrisma();
    prisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'org1' },
    ]);
    prisma.organizationMembership.count.mockResolvedValue(0);
    prisma.driver.count.mockResolvedValue(0);
    const { service } = makeService(prisma);

    expect((await service.status('u1')).blockers).toEqual([]);
  });

  it('does not block an owner who has a co-owner', async () => {
    const prisma = makePrisma();
    prisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: 'org1' },
    ]);
    prisma.organizationMembership.count.mockResolvedValue(1);
    prisma.driver.count.mockResolvedValue(4);
    const { service } = makeService(prisma);

    expect((await service.status('u1')).blockers).toEqual([]);
  });

  it('reports an unpaid invoice', async () => {
    const prisma = makePrisma();
    prisma.invoice.count.mockResolvedValue(1);
    const { service } = makeService(prisma);

    expect((await service.status('u1')).blockers).toEqual(['unpaidInvoice']);
  });
});

describe('AccountDeletionService · requesting', () => {
  it('schedules thirty days out, signs every device out, and audits it', async () => {
    const prisma = makePrisma();
    const { service, audit, mail } = makeService(prisma);

    const receipt = await service.request('u1', { ip: '203.0.113.1' });

    expect(receipt.alreadyPending).toBe(false);
    expect(receipt.graceDays).toBe(DELETION_GRACE_DAYS);

    const update = prisma.user.update.mock.calls[0][0];
    expect(update.data.deletionScheduledFor).toBeInstanceOf(Date);
    // Step 3: the decision reaches every device now, not in thirty days.
    expect(update.data.tokenVersion).toEqual({ increment: 1 });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();

    expect(audit.record.mock.calls[0][0].action).toBe(
      'auth.account_deletion_requested',
    );
    expect(mail.send).toHaveBeenCalled();
  });

  it('hands back the export, taken before anything changed', async () => {
    const prisma = makePrisma();
    const { service, care } = makeService(prisma);

    const receipt = await service.request('u1');

    expect(receipt.data.formatVersion).toBe(1);
    expect(receipt.data.account.email).toBe('ada@example.com');
    expect(care.snapshot).toHaveBeenCalledWith('u1');
    // A deletion with no export is a deletion the person cannot check.
    expect(care.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.user.update.mock.invocationCallOrder[0]!,
    );
  });

  it('never puts a credential in the export', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    // `note` is excluded because it is the sentence *explaining* that
    // credentials are absent, and it names them in order to say so.
    const { note, ...payload } = (await service.request('u1')).data;
    const serialised = JSON.stringify(payload);

    expect(note).toMatch(/deliberately excluded/);
    for (const forbidden of [
      'passwordHash',
      'tokenVersion',
      'recoveryCode',
      'secret',
      'tokenHash',
      'refreshToken',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('refuses, and changes nothing, while somebody is in a car', async () => {
    const prisma = makePrisma();
    prisma.ride.count.mockResolvedValue(1);
    const { service, mail } = makeService(prisma);

    await expect(service.request('u1')).rejects.toBeInstanceOf(ConflictError);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('is idempotent: a second tap is not a second deletion', async () => {
    const scheduledFor = new Date('2026-10-17T09:00:00.000Z');
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'ada@example.com',
      fullName: 'Ada',
      phone: null,
      timeZone: 'UTC',
      locale: 'en-US',
      emailVerifiedAt: null,
      createdAt: new Date(),
      simplifiedMode: false,
      deletionRequestedAt: new Date('2026-09-17T09:00:00.000Z'),
      deletionScheduledFor: scheduledFor,
      isTombstone: false,
    });
    const { service, mail } = makeService(prisma);

    const receipt = await service.request('u1');

    expect(receipt.alreadyPending).toBe(true);
    expect(receipt.scheduledFor).toEqual(scheduledFor);
    expect(prisma.user.update).not.toHaveBeenCalled();
    // No second email either: nothing changed, so there is nothing to announce.
    expect(mail.send).not.toHaveBeenCalled();
    // The export is re-taken, because the first copy may be what got lost.
    expect(receipt.data.formatVersion).toBe(1);
  });

  it('refuses a tombstone outright', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 't', isTombstone: true });
    const { service } = makeService(prisma);

    await expect(service.request('t')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('AccountDeletionService · the public path', () => {
  it('says nothing about an address with no account', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const { service, credentials, mail } = makeService(prisma);

    // Resolves rather than throwing. Whether an address has an account is a
    // fact about a person who, for this product, has a vulnerable relative.
    await expect(service.requestByEmail('nobody@example.com')).resolves.toBeUndefined();
    expect(credentials.issue).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('issues a single-use link for an address that does have one', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'ada@example.com',
      isTombstone: false,
    });
    const { service, credentials, mail } = makeService(prisma);

    await service.requestByEmail('  ADA@example.com ');

    expect(credentials.issue).toHaveBeenCalledWith(
      'u1',
      'ada@example.com',
      'accountDeletion',
      expect.anything(),
    );
    expect(mail.send).toHaveBeenCalled();
  });

  it('spends the token and then applies the same rules as the in-app path', async () => {
    const prisma = makePrisma();
    prisma.ride.count.mockResolvedValue(1);
    const { service, credentials } = makeService(prisma);

    // The public route does not get to skip the rule about somebody being in
    // a car.
    await expect(service.confirmByToken('tok')).rejects.toBeInstanceOf(ConflictError);
    expect(credentials.consume).toHaveBeenCalledWith('tok', 'accountDeletion', prisma);
  });
});

describe('AccountDeletionService · cancelling', () => {
  it('does nothing, quietly, when no deletion is pending', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      email: 'ada@example.com',
      deletionRequestedAt: null,
    });
    const { service, mail } = makeService(prisma);

    expect(await service.cancel('u1')).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('clears both dates together, audits, and says so', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      email: 'ada@example.com',
      deletionRequestedAt: new Date(),
    });
    const { service, audit, mail } = makeService(prisma);

    expect(await service.cancel('u1')).toBe(true);

    // Either half alone is a row that silently does nothing — the database
    // CHECK constraint says the same thing.
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      deletionRequestedAt: null,
      deletionScheduledFor: null,
    });
    expect(audit.record.mock.calls[0][0].action).toBe(
      'auth.account_deletion_cancelled',
    );
    expect(mail.send).toHaveBeenCalled();
  });
});

describe('AccountDeletionService · the sweep', () => {
  it('does nothing when nothing is due', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    expect(await service.executeDue()).toBe(0);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('lets a cancellation win the race with its own transaction', async () => {
    // Scanned as due, then cancelled before the transaction read it. Signing
    // in is allowed to win — that is what the grace period is for.
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'ada@example.com',
      timeZone: 'UTC',
      locale: 'en-US',
      deletionScheduledFor: null,
      isTombstone: false,
    });
    const { service, mail } = makeService(prisma);

    expect(await service.executeDue()).toBe(0);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('will not execute one whose date has not arrived', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'ada@example.com',
      timeZone: 'UTC',
      locale: 'en-US',
      deletionScheduledFor: new Date(Date.now() + 60_000),
      isTombstone: false,
    });
    const { service } = makeService(prisma);

    expect(await service.executeDue()).toBe(0);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('keeps one failed erasure from stopping the rest of the batch', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === 'bad') throw new Error('foreign key nobody anticipated');
        return Promise.resolve({
          id: 'good',
          email: 'ada@example.com',
          timeZone: 'UTC',
          locale: 'en-US',
          deletionScheduledFor: null, // skipped, but reached — that is the point
          isTombstone: false,
        });
      },
    );
    const { service } = makeService(prisma);

    // The failure is swallowed and logged; the next account is still tried.
    await expect(service.executeDue()).resolves.toBe(0);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('purges nothing when no patient has been orphaned long enough', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    expect(await service.purgeOrphanedPatients()).toBe(0);
    expect(prisma.patient.findMany).toHaveBeenCalled();
  });
});
