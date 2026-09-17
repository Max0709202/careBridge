/**
 * What "delete my account" does to each thing hanging off a user.
 *
 * ADR-0013 is the decision; this is the decision made executable. The rule it
 * exists to enforce is that **every relation on `User` has a disposition
 * stated here** — a relation with no entry is a bug, not a default — and
 * `account-deletion.spec.ts` reads `prisma/schema.prisma` and fails if the two
 * ever disagree. That test is the point of this file. Without it the policy
 * decays the first time somebody adds a relation and does not think about
 * deletion, which is every time.
 *
 * Deletion here means **the person becomes unidentifiable, not that history
 * becomes untrue**. Audit rows are append-only for seven years and payment
 * records for the same, so "delete my account" cannot mean "delete the record
 * that a payment happened". It can, and does, mean that nothing left behind
 * names them.
 *
 * Nothing in this module touches a database. It decides; the service acts.
 */

/** Every relation declared on `model User`, exactly as the schema spells it. */
export type UserRelation =
  | 'refreshTokens'
  | 'access'
  | 'notifications'
  | 'consents'
  | 'credentialTokens'
  | 'mfaEnrolment'
  | 'deviceTokens'
  | 'notificationPreferences'
  | 'invitationsSent'
  | 'invitationsAccepted'
  | 'idempotencyRecords'
  | 'memberships'
  | 'billingAccount'
  | 'seatChanges'
  | 'driversApproved'
  | 'driverProfile'
  | 'documentsReviewed'
  | 'refundsRequested'
  | 'flagsChanged'
  | 'caregiverProfile'
  | 'bookingsRequested'
  | 'reviewsWritten'
  | 'disputesRaised'
  | 'disputesResolved';

export type Disposition =
  /** The row's only purpose was serving this user. It goes. */
  | 'delete'
  /**
   * The row survives; the identity attached to it does not. Its foreign key is
   * repointed at the deletion's tombstone user, and any identifying column it
   * carries of its own is overwritten — see `IDENTIFYING_COLUMNS`.
   */
  | 'anonymise'
  /**
   * Delete it if it was never used, anonymise it if it was. Only invitations:
   * an accepted invitation is the history of how a live grant came to exist,
   * and an unaccepted one is a live capability that must not outlive the person
   * who issued it.
   */
  | 'deleteIfUnused';

/**
 * The table. Ordered as the schema orders the relations, so the two can be read
 * side by side.
 *
 * `auditLogs` is deliberately absent, and its absence is not an oversight:
 * `AuditLog.actorUserId` is a bare column with no foreign key at all, so no
 * cascade can reach it and no relation exists to list. It is anonymised by
 * `AccountDeletionService` with a plain column update, and it is the one
 * relation whose handling is asserted directly by the e2e suite rather than
 * inferred from this map.
 */
export const USER_RELATION_DISPOSITIONS: Record<UserRelation, Disposition> = {
  // ─── credentials and preferences: the substance of what a person means by
  // "delete my account" ─────────────────────────────────────────────────────
  refreshTokens: 'delete',
  credentialTokens: 'delete',
  mfaEnrolment: 'delete',
  deviceTokens: 'delete',
  notificationPreferences: 'delete',
  /** No evidentiary value, and a push token outliving its account is a message to a stranger's phone. */
  notifications: 'delete',
  /** Hashes of requests nobody will repeat. */
  idempotencyRecords: 'delete',
  /** The grant goes. Whether the *patient* goes is a separate question — see `orphanedPatientIds`. */
  access: 'delete',

  // ─── invitations ──────────────────────────────────────────────────────────
  invitationsSent: 'deleteIfUnused',
  invitationsAccepted: 'anonymise',

  // ─── records regulation or an investigation needs ─────────────────────────
  /** Evidence that consent was given. Losing it loses our own defence. */
  consents: 'anonymise',
  /** "Who could see the dispatch queue last March" is a question an investigation asks. */
  memberships: 'anonymise',
  /** Seven years, financial regulation. Note the FK cascades — see the ordering rule below. */
  billingAccount: 'anonymise',
  seatChanges: 'anonymise',

  // ─── acts by an administrator. The act is the record; the actor's identity
  // is not what makes it meaningful ─────────────────────────────────────────
  driversApproved: 'anonymise',
  documentsReviewed: 'anonymise',
  refundsRequested: 'anonymise',
  flagsChanged: 'anonymise',
  disputesResolved: 'anonymise',

  // ─── the person's own service records ─────────────────────────────────────
  /** The operator's driver record survives; it stops naming or linking to a person. */
  driverProfile: 'anonymise',
  caregiverProfile: 'anonymise',
  bookingsRequested: 'anonymise',
  reviewsWritten: 'anonymise',
  disputesRaised: 'anonymise',
};

/**
 * Anonymised rows that carry identity in their own columns.
 *
 * Repointing a foreign key is not enough for these: the row would stop being
 * *linked* to a person while still spelling their name out. The service
 * overwrites every column listed here, and the e2e suite asserts that none of
 * the deleted account's identifiers survives anywhere.
 */
export const IDENTIFYING_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  /** Where invoices and dunning went. An address, on a row kept for seven years. */
  BillingAccount: ['billingEmail'],
  /** The name a dispatcher saw, and the address the invitation went to. */
  Driver: ['displayName', 'invitedEmail'],
  /** A public profile, written by the person, about the person. */
  Caregiver: ['displayName', 'bio'],
  /** The address the invitation was bound to. */
  PatientInvitation: ['email'],
};

/**
 * Relations whose foreign key is `onDelete: Cascade` **and** whose disposition
 * is `anonymise`.
 *
 * These are the reason the order of operations is repoint-then-delete rather
 * than delete-and-let-the-database-sort-it-out. Deleting the user row first
 * would take a billing account and seven years of invoices with it — which is
 * precisely the failure ADR-0013 rejects the cascade approach for, and it is
 * reachable by one statement in the wrong order.
 */
export const CASCADE_BEFORE_ANONYMISE: readonly UserRelation[] = [
  'billingAccount',
  'consents',
  'memberships',
  'caregiverProfile',
];

// ─── the grace period ───────────────────────────────────────────────────────

/**
 * Thirty days, cancellable by signing in.
 *
 * Not a compliance ceiling and not a dark pattern. The most common reason a
 * last caregiver leaves this product is a mistake or a family argument, and the
 * second most common is bereavement — which is not a moment to make anything
 * irreversible. ADR-0013 records that a jurisdiction demanding faster deletion
 * would make this a compliance problem rather than a kindness, and is what
 * would make us revisit it.
 */
export const DELETION_GRACE_DAYS = 30;

/**
 * And thirty more for a patient whose last caregiver just left.
 *
 * Measured from the moment the patient is orphaned, which is the moment the
 * deletion *executes* — so a patient's data outlives the account by up to
 * sixty days in total. That is deliberate: the patient is the person least able
 * to ask for any of this back, and nobody else can ask on their behalf once the
 * last grant is gone.
 */
export const PATIENT_PURGE_GRACE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function deletionExecutesAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);
}

export function patientPurgeDueAt(orphanedAt: Date): Date {
  return new Date(orphanedAt.getTime() + PATIENT_PURGE_GRACE_DAYS * DAY_MS);
}

/**
 * Due when the scheduled moment has passed, not when it arrives.
 *
 * `>=` rather than `>` so a sweep that happens to run on the exact millisecond
 * executes rather than waiting a further day, and so the boundary is testable
 * without depending on which side of it a clock lands.
 */
export function isDeletionDue(scheduledFor: Date, now: Date): boolean {
  return now.getTime() >= scheduledFor.getTime();
}

export function daysUntil(scheduledFor: Date, now: Date): number {
  return Math.max(0, Math.ceil((scheduledFor.getTime() - now.getTime()) / DAY_MS));
}

// ─── refusal ────────────────────────────────────────────────────────────────

/**
 * States where deletion is not a data question.
 *
 * Each one is a case where executing would do something to somebody other than
 * the person asking, so each is refused with a message that says what to do
 * instead. A refusal with no remedy is a dead end, and a dead end in this
 * screen is what makes a person email support instead — which is the thing the
 * stores specifically refuse to accept.
 */
export type DeletionBlocker =
  | 'rideInFlight'
  | 'lastOrganizationOwner'
  | 'unpaidInvoice';

export interface AccountDeletionSnapshot {
  /** Rides on this user's patients that are neither terminal nor unassigned. */
  ridesInFlight: number;
  /** Organisations where this user is the only remaining owner and drivers are still active. */
  organizationsLeftWithoutAnOwner: number;
  /** Invoices owed by this user's billing account, inside their grace window. */
  unpaidInvoices: number;
}

/**
 * Every reason, not the first.
 *
 * A person with two problems who is told about one of them fixes it, comes
 * back, and is told about the other. The dispatch queue returns every reason a
 * driver is unavailable for exactly the same reason.
 */
export function blockersFor(
  snapshot: AccountDeletionSnapshot,
): readonly DeletionBlocker[] {
  const blockers: DeletionBlocker[] = [];
  if (snapshot.ridesInFlight > 0) blockers.push('rideInFlight');
  if (snapshot.organizationsLeftWithoutAnOwner > 0) {
    blockers.push('lastOrganizationOwner');
  }
  if (snapshot.unpaidInvoices > 0) blockers.push('unpaidInvoice');
  return blockers;
}

export function canDelete(snapshot: AccountDeletionSnapshot): boolean {
  return blockersFor(snapshot).length === 0;
}

/**
 * What the person reads. No counts and no ids — a blocker message is shown to
 * whoever holds the account, which for the ride case may not be the person in
 * the car.
 */
export function describeBlocker(blocker: DeletionBlocker): string {
  switch (blocker) {
    case 'rideInFlight':
      return 'A journey is under way right now. Deletion waits until it finishes — try again once everyone is home.';
    case 'lastOrganizationOwner':
      return 'You are the last owner of a transport operator that still has drivers. Make somebody else an owner first, or the fleet is left with nobody who can manage it.';
    case 'unpaidInvoice':
      return 'There is an unpaid invoice on the account. Settle it, or ask us to write it off, and then delete.';
  }
}

// ─── the tombstone ──────────────────────────────────────────────────────────

/**
 * One tombstone user per deletion, carrying no name, no email and no phone.
 *
 * Per deletion rather than one shared forever, so the rows left behind still
 * show that a single now-deleted person did all of them — which is what an
 * investigation into one administrator's actions actually needs — without
 * showing who. A single global tombstone would merge every deleted person's
 * history into one indistinguishable actor.
 *
 * The address is under `.invalid`, which RFC 2606 reserves and guarantees can
 * never resolve. A tombstone that could receive mail is a tombstone that can be
 * mailed.
 */
export function tombstoneIdentity(tombstoneId: string): {
  email: string;
  fullName: string;
} {
  return {
    email: `deleted-${tombstoneId}@deleted.invalid`,
    fullName: 'Deleted account',
  };
}
