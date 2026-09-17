import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CASCADE_BEFORE_ANONYMISE,
  DELETION_GRACE_DAYS,
  IDENTIFYING_COLUMNS,
  PATIENT_PURGE_GRACE_DAYS,
  USER_RELATION_DISPOSITIONS,
  blockersFor,
  canDelete,
  daysUntil,
  deletionExecutesAt,
  describeBlocker,
  isDeletionDue,
  patientPurgeDueAt,
  tombstoneIdentity,
  type AccountDeletionSnapshot,
  type DeletionBlocker,
  type UserRelation,
} from './account-deletion';

const SCHEMA = readFileSync(
  join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
  'utf8',
);

/**
 * Every relation the schema declares on `model User`.
 *
 * A field is a relation when its declared type is the name of a model. Deriving
 * it that way rather than from a hand-kept list of scalars means a new enum on
 * `User` does not get mistaken for a relation, and a new relation cannot hide.
 */
function userRelationsFromSchema(): string[] {
  const models = new Set(
    [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!),
  );

  const block = /^model\s+User\s*\{([\s\S]*?)^\}/m.exec(SCHEMA);
  if (!block) throw new Error('model User not found in schema.prisma');

  const relations: string[] = [];
  for (const raw of block[1]!.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('@@')) continue;

    const field = /^(\w+)\s+(\w+)/.exec(line);
    if (!field) continue;

    if (models.has(field[2]!)) relations.push(field[1]!);
  }
  return relations;
}

describe('account deletion · the disposition table', () => {
  /**
   * The test this module exists for.
   *
   * ADR-0013: "every relation on `User` gets one explicitly — a relation with
   * no listed disposition is a bug, not a default". Nothing but a test can
   * hold that, because the failure mode is somebody adding a relation and not
   * thinking about deletion, and a person who is not thinking about deletion
   * does not go and read a document about it.
   */
  it('covers every relation the schema declares on User, and invents none', () => {
    const fromSchema = userRelationsFromSchema().sort();
    const fromTable = Object.keys(USER_RELATION_DISPOSITIONS).sort();

    expect(fromTable).toEqual(fromSchema);
  });

  it('found a plausible number of relations, so a parse failure cannot pass as agreement', () => {
    // Guards the test above: if the regex silently matched nothing, two empty
    // arrays would compare equal and the whole assertion would be vacuous.
    expect(userRelationsFromSchema().length).toBeGreaterThan(20);
  });

  it('keeps audit rows out of the table, because they are not a relation', () => {
    // AuditLog.actorUserId is a bare column with no foreign key, so no cascade
    // reaches it and there is no relation to list. Anonymised by a column
    // update instead — asserted in the e2e suite, not here.
    expect(USER_RELATION_DISPOSITIONS).not.toHaveProperty('auditLogs');
    expect(SCHEMA).toMatch(/actorUserId\s+String\?/);
  });

  it('deletes credentials and keeps money', () => {
    expect(USER_RELATION_DISPOSITIONS.refreshTokens).toBe('delete');
    expect(USER_RELATION_DISPOSITIONS.mfaEnrolment).toBe('delete');
    expect(USER_RELATION_DISPOSITIONS.credentialTokens).toBe('delete');

    // "Delete my account" cannot mean "delete the record that a payment
    // happened" — seven years, financial regulation.
    expect(USER_RELATION_DISPOSITIONS.billingAccount).toBe('anonymise');
    expect(USER_RELATION_DISPOSITIONS.seatChanges).toBe('anonymise');
  });

  it('splits invitations by whether they were ever used', () => {
    // An unaccepted invitation is a live capability and must not outlive its
    // inviter; an accepted one is how a grant that still exists came to be.
    expect(USER_RELATION_DISPOSITIONS.invitationsSent).toBe('deleteIfUnused');
    expect(USER_RELATION_DISPOSITIONS.invitationsAccepted).toBe('anonymise');
  });

  it('keeps an administrator’s acts and drops the administrator', () => {
    for (const relation of [
      'driversApproved',
      'documentsReviewed',
      'refundsRequested',
      'flagsChanged',
      'disputesResolved',
    ] satisfies UserRelation[]) {
      expect(USER_RELATION_DISPOSITIONS[relation]).toBe('anonymise');
    }
  });

  it('lists only anonymised relations as needing repointing before the delete', () => {
    // A relation in this list with disposition `delete` would be a
    // contradiction: it says "save this from the cascade" about a row that is
    // meant to go.
    for (const relation of CASCADE_BEFORE_ANONYMISE) {
      expect(USER_RELATION_DISPOSITIONS[relation]).toBe('anonymise');
    }
  });

  it('names identifying columns only on tables the schema actually has', () => {
    for (const [model, columns] of Object.entries(IDENTIFYING_COLUMNS)) {
      const block = new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(
        SCHEMA,
      );
      expect(block).not.toBeNull();
      for (const column of columns) {
        expect(block![1]!).toMatch(new RegExp(`^\\s*${column}\\s+`, 'm'));
      }
    }
  });
});

describe('account deletion · the grace period', () => {
  const requestedAt = new Date('2026-09-17T09:00:00.000Z');

  it('schedules execution thirty days out', () => {
    expect(deletionExecutesAt(requestedAt).toISOString()).toBe(
      '2026-10-17T09:00:00.000Z',
    );
    expect(DELETION_GRACE_DAYS).toBe(30);
  });

  it('gives an orphaned patient thirty days of its own', () => {
    expect(patientPurgeDueAt(new Date('2026-10-17T09:00:00.000Z')).toISOString()).toBe(
      '2026-11-16T09:00:00.000Z',
    );
    expect(PATIENT_PURGE_GRACE_DAYS).toBe(30);
  });

  it('is due on the boundary, not a day later', () => {
    const at = deletionExecutesAt(requestedAt);
    expect(isDeletionDue(at, new Date(at.getTime() - 1))).toBe(false);
    expect(isDeletionDue(at, at)).toBe(true);
    expect(isDeletionDue(at, new Date(at.getTime() + 1))).toBe(true);
  });

  it('counts whole days remaining, and never negative ones', () => {
    const at = deletionExecutesAt(requestedAt);
    expect(daysUntil(at, requestedAt)).toBe(30);
    expect(daysUntil(at, new Date('2026-10-16T09:00:00.000Z'))).toBe(1);
    // Past due reads as zero rather than as a negative countdown on a screen.
    expect(daysUntil(at, new Date('2026-11-01T00:00:00.000Z'))).toBe(0);
  });
});

describe('account deletion · refusal', () => {
  const clear: AccountDeletionSnapshot = {
    ridesInFlight: 0,
    organizationsLeftWithoutAnOwner: 0,
    unpaidInvoices: 0,
  };

  it('allows deletion when nothing is in the way', () => {
    expect(blockersFor(clear)).toEqual([]);
    expect(canDelete(clear)).toBe(true);
  });

  it('refuses while somebody is in a car', () => {
    const snapshot = { ...clear, ridesInFlight: 1 };
    expect(blockersFor(snapshot)).toEqual(['rideInFlight']);
    expect(canDelete(snapshot)).toBe(false);
  });

  it('refuses to strand a fleet', () => {
    expect(blockersFor({ ...clear, organizationsLeftWithoutAnOwner: 1 })).toEqual([
      'lastOrganizationOwner',
    ]);
  });

  it('refuses to be a way of writing off a debt', () => {
    expect(blockersFor({ ...clear, unpaidInvoices: 2 })).toEqual(['unpaidInvoice']);
  });

  it('returns every reason, not the first', () => {
    // Somebody told about one of their two problems fixes it, comes back, and
    // is told about the other.
    expect(
      blockersFor({
        ridesInFlight: 1,
        organizationsLeftWithoutAnOwner: 1,
        unpaidInvoices: 1,
      }),
    ).toEqual(['rideInFlight', 'lastOrganizationOwner', 'unpaidInvoice']);
  });

  it('has a message with a remedy for every blocker', () => {
    const all: DeletionBlocker[] = [
      'rideInFlight',
      'lastOrganizationOwner',
      'unpaidInvoice',
    ];
    for (const blocker of all) {
      const message = describeBlocker(blocker);
      expect(message.length).toBeGreaterThan(20);
      // No counts and no ids: this is read by whoever holds the account, who
      // in the ride case may not be the person in the car.
      expect(message).not.toMatch(/\d/);
    }
  });
});

describe('account deletion · the tombstone', () => {
  it('carries no name and an address that can never resolve', () => {
    const identity = tombstoneIdentity('4f0e3c1a');

    expect(identity.fullName).toBe('Deleted account');
    // RFC 2606 reserves .invalid. A tombstone that could receive mail is a
    // tombstone that can be mailed.
    expect(identity.email).toMatch(/@deleted\.invalid$/);
    expect(identity.email).toContain('4f0e3c1a');
  });

  it('is distinct per deletion, so two deleted people do not merge', () => {
    expect(tombstoneIdentity('a').email).not.toBe(tombstoneIdentity('b').email);
  });
});
