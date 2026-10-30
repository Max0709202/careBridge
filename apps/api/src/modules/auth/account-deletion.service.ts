import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { CareService } from '../care/care.service';
import { CredentialTokensService } from './credential-tokens.service';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { MAIL, type MailPort } from '../../infrastructure/mail/mail.port';
import { ConflictError, NotFoundError } from '../../common/errors';
import { LOCATION_SHARING_STATUSES } from '../../domain/ride-status';
import { occupiesSeat } from '../../domain/driver-status';
import {
  DELETION_GRACE_DAYS,
  PATIENT_PURGE_GRACE_DAYS,
  blockersFor,
  deletionExecutesAt,
  describeBlocker,
  isDeletionDue,
  tombstoneIdentity,
  type AccountDeletionSnapshot,
  type DeletionBlocker,
} from '../../domain/account-deletion';
import {
  accountDeletedEmail,
  accountDeletionCancelledEmail,
  accountDeletionLinkEmail,
  accountDeletionScheduledEmail,
} from './mail-templates';
import type { RequestContext } from './auth.service';

export interface DeletionStatus {
  blockers: readonly DeletionBlocker[];
  blockerMessages: readonly string[];
}

export interface DeletionReceipt {
  scheduledFor: Date;
  graceDays: number;
  /** Already pending when asked. The request is idempotent; a second tap is not a second deletion. */
  alreadyPending: boolean;
  /** Everything we held, as it was at the moment of the request. */
  data: AccountExport;
}

export interface AccountExport {
  exportedAt: string;
  /** Bumped when the shape changes, so a file somebody kept can be read years later. */
  formatVersion: number;
  note: string;
  account: Record<string, unknown>;
  care: unknown;
  consents: unknown[];
  organizationMemberships: unknown[];
  billing: Record<string, unknown> | null;
  driverProfile: Record<string, unknown> | null;
  caregiverProfile: Record<string, unknown> | null;
}

/**
 * Account deletion — ADR-0013, made to happen.
 *
 * Four entry points, because Apple and Play want different doors into the same
 * room: a signed-in request from the app (Apple 5.1.1(v) requires it be
 * possible *inside* the app), an emailed-link request from a public web page
 * (Play requires it be possible *without* the app), a cancellation, and the
 * sweep that eventually executes.
 *
 * The shape of the operation, in the ADR's order:
 *
 *   1. **Export first.** A deletion with no export is a deletion the person
 *      cannot check. The export is taken before any state changes, so what
 *      they receive is what was actually there when they asked.
 *   2. **A thirty-day grace period,** cancelled by signing in.
 *   3. **Sign out everywhere immediately** — on request, not on execution, so
 *      the decision reaches every device at once.
 *   4. **Executed by the sweep,** not by the request. A job scheduled at
 *      request time can be lost by a restart; a sweep cannot be forgotten.
 *   5. **The deletion is itself audited,** and that row is one of the ones
 *      that survives — reattributed to the tombstone, like every other row
 *      the account leaves behind.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  /** One user at a time, so a slow erasure cannot hold a transaction open across the batch. */
  private static readonly EXECUTE_BATCH = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly care: CareService,
    private readonly billing: BillingService,
    private readonly credentials: CredentialTokensService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL) private readonly mail: MailPort,
  ) {}

  // ─── reading the state ────────────────────────────────────────────────────

  /**
   * Why deletion would currently be refused, if it would.
   *
   * Computed on read as well as on write: showing the blockers before the
   * person commits is the difference between a screen that explains itself and
   * one that accepts a tap and then refuses it.
   *
   * It reports no *pending* state, and that absence is a consequence of
   * ADR-0013 rather than an omission. The request signs every device out (step
   * 3) and signing back in cancels it (step 2), so there is no session in which
   * a pending deletion could be observed. The date reaches the account holder
   * in the response to the request itself, and in the email.
   */
  async status(userId: string): Promise<DeletionStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isTombstone: true },
    });
    if (!user || user.isTombstone) throw new NotFoundError();

    const blockers = blockersFor(await this.snapshotFor(userId));

    return { blockers, blockerMessages: blockers.map(describeBlocker) };
  }

  /**
   * The three states where deletion would do something to somebody else.
   *
   * "In flight" reuses `LOCATION_SHARING_STATUSES` rather than defining a
   * fourth notion of it. That list is already the single definition of
   * "somebody is on a journey right now" — it is what the driver app's writes
   * are checked against and what the staleness watchdog queries — and a
   * private copy here would be the one that drifts.
   */
  async snapshotFor(userId: string): Promise<AccountDeletionSnapshot> {
    const [ridesInFlight, organizationsLeftWithoutAnOwner, unpaidInvoices] =
      await Promise.all([
        this.ridesInFlightFor(userId),
        this.organizationsLeftWithoutAnOwner(userId),
        this.unpaidInvoicesFor(userId),
      ]);

    return { ridesInFlight, organizationsLeftWithoutAnOwner, unpaidInvoices };
  }

  private async ridesInFlightFor(userId: string): Promise<number> {
    const grants = await this.prisma.patientAccess.findMany({
      where: { userId, revokedAt: null },
      select: { patientId: true },
    });

    // Both sides of the journey: a family member whose relative is in a car,
    // and the driver of that car, are each blocked by the same ride.
    return this.prisma.ride.count({
      where: {
        status: { in: [...LOCATION_SHARING_STATUSES] },
        OR: [
          { patientId: { in: grants.map((g) => g.patientId) } },
          { driver: { userId } },
        ],
      },
    });
  }

  /**
   * Organisations this user owns that would be left with nobody who can manage
   * them.
   *
   * Only counts when drivers are still active. An operator that has wound down
   * is not a fleet being stranded, and refusing there would leave the last
   * owner of a dead company permanently unable to delete their account.
   */
  private async organizationsLeftWithoutAnOwner(userId: string): Promise<number> {
    const owned = await this.prisma.organizationMembership.findMany({
      where: { userId, role: 'owner', revokedAt: null },
      select: { organizationId: true },
    });

    let stranded = 0;
    for (const { organizationId } of owned) {
      const [otherOwners, activeDrivers] = await Promise.all([
        this.prisma.organizationMembership.count({
          where: {
            organizationId,
            role: 'owner',
            revokedAt: null,
            userId: { not: userId },
          },
        }),
        this.prisma.driver.count({
          where: { organizationId, status: { notIn: ['offboarded'] } },
        }),
      ]);

      if (otherOwners === 0 && activeDrivers > 0) stranded += 1;
    }
    return stranded;
  }

  private async unpaidInvoicesFor(userId: string): Promise<number> {
    return this.prisma.invoice.count({
      where: { status: 'open', billingAccount: { ownerUserId: userId } },
    });
  }

  // ─── requesting ───────────────────────────────────────────────────────────

  /**
   * The signed-in path. Apple 5.1.1(v): an app that supports account creation
   * must support account deletion from inside the app, and a support email
   * address is explicitly not sufficient.
   */
  async request(userId: string, ctx: RequestContext = {}): Promise<DeletionReceipt> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isTombstone) throw new NotFoundError();

    // Idempotent. A person who taps twice, or whose connection dropped before
    // the response arrived, has made one request — and re-exporting is the
    // kind thing to do, since the first copy may be what got lost.
    if (user.deletionRequestedAt && user.deletionScheduledFor) {
      return {
        scheduledFor: user.deletionScheduledFor,
        graceDays: DELETION_GRACE_DAYS,
        alreadyPending: true,
        data: await this.exportFor(userId),
      };
    }

    const blockers = blockersFor(await this.snapshotFor(userId));
    if (blockers.length > 0) {
      throw new ConflictError(blockers.map(describeBlocker).join(' '));
    }

    // Before anything changes.
    const data = await this.exportFor(userId);

    const requestedAt = new Date();
    const scheduledFor = deletionExecutesAt(requestedAt);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          deletionRequestedAt: requestedAt,
          deletionScheduledFor: scheduledFor,
          // Step 3: the decision takes effect on every device at once, now,
          // rather than in thirty days. Somebody deleting their account
          // because they no longer trust who has their phone is served by this
          // and not by a deletion that quietly leaves sessions alive.
          tokenVersion: { increment: 1 },
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: requestedAt, revokedReason: 'account_deletion_requested' },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'auth.account_deletion_requested',
          entityType: 'User',
          entityId: userId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: [
            'deletionRequestedAt',
            'deletionScheduledFor',
            'tokenVersion',
          ],
        },
        tx,
      );
    });

    await this.sendSafely(
      accountDeletionScheduledEmail(
        {
          appUrl: this.config.PUBLIC_APP_URL,
          correlationId: ctx.correlationId ?? undefined,
        },
        {
          to: user.email,
          executesOn: formatDate(scheduledFor),
          graceDays: DELETION_GRACE_DAYS,
        },
      ),
    );

    return {
      scheduledFor,
      graceDays: DELETION_GRACE_DAYS,
      alreadyPending: false,
      data,
    };
  }

  /**
   * The public path. Play requires deletion to be requestable at a reachable
   * URL without installing the app.
   *
   * Always resolves, whatever the address turns out to be — the same rule as
   * password reset, for the same reason. Whether an address has a CareBridge
   * account is a fact about a person, and for this product that person has a
   * vulnerable relative. An endpoint that answered honestly would be a way to
   * enumerate exactly that list.
   */
  async requestByEmail(email: string, ctx: RequestContext = {}): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, isTombstone: true },
    });

    if (!user || user.isTombstone) {
      this.logger.log('Deletion link requested for an address with no account');
      return;
    }

    const issued = await this.credentials.issue(
      user.id,
      user.email,
      'accountDeletion',
      ctx,
    );

    await this.sendSafely(
      accountDeletionLinkEmail(
        {
          appUrl: this.config.PUBLIC_APP_URL,
          correlationId: ctx.correlationId ?? undefined,
        },
        {
          to: user.email,
          token: issued.token,
          expiresInMinutes: this.config.PASSWORD_RESET_TTL_MINUTES,
        },
      ),
    );
  }

  /**
   * Spends the emailed token and schedules the deletion.
   *
   * The token is consumed inside the same transaction as the scheduling, so
   * two requests racing on a double-clicked link cannot both win. Blockers are
   * checked here too: the public path must not be the one that gets to skip
   * the rule about somebody being in a car.
   */
  async confirmByToken(
    token: string,
    ctx: RequestContext = {},
  ): Promise<DeletionReceipt> {
    const { userId } = await this.prisma.$transaction((tx) =>
      this.credentials.consume(token, 'accountDeletion', tx),
    );

    return this.request(userId, ctx);
  }

  // ─── cancelling ───────────────────────────────────────────────────────────

  /**
   * Signing in cancels it. ADR-0013 chose that as the whole mechanism, on the
   * grounds that a deletion request in this product's domain is usually made
   * by somebody having a bad week.
   *
   * Returns whether anything was pending, so the caller can tell the person it
   * happened. A cancellation nobody is told about is indistinguishable from a
   * deletion that silently failed.
   */
  async cancel(userId: string, ctx: RequestContext = {}): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, deletionRequestedAt: true },
    });
    if (!user?.deletionRequestedAt) return false;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { deletionRequestedAt: null, deletionScheduledFor: null },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'auth.account_deletion_cancelled',
          entityType: 'User',
          entityId: userId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['deletionRequestedAt', 'deletionScheduledFor'],
        },
        tx,
      );
    });

    await this.sendSafely(
      accountDeletionCancelledEmail(
        {
          appUrl: this.config.PUBLIC_APP_URL,
          correlationId: ctx.correlationId ?? undefined,
        },
        { to: user.email },
      ),
    );

    return true;
  }

  // ─── the export ───────────────────────────────────────────────────────────

  /**
   * Everything we hold about this account, in one JSON document.
   *
   * `care` is the app's own snapshot rather than a second hand-written
   * assembly of the same rows. That is deliberate: an export built separately
   * drifts from what the product actually stores, and the drift is always in
   * the direction of omitting something. If the app can see it, the export
   * contains it, and there is one implementation of "it".
   *
   * Credentials are absent, and their absence is the point — a password hash,
   * a recovery code or a refresh token in a file the person emails to
   * themselves is a credential in their inbox.
   */
  async exportFor(userId: string): Promise<AccountExport> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isTombstone) throw new NotFoundError();

    const [
      care,
      consents,
      memberships,
      billingAccount,
      driverProfile,
      caregiverProfile,
    ] = await Promise.all([
      this.care.snapshot(userId),
      this.prisma.userConsent.findMany({
        where: { userId },
        select: { type: true, documentVersion: true, acceptedAt: true },
        orderBy: { acceptedAt: 'asc' },
      }),
      this.prisma.organizationMembership.findMany({
        where: { userId },
        select: {
          role: true,
          joinedAt: true,
          revokedAt: true,
          organization: { select: { name: true, slug: true } },
        },
      }),
      this.prisma.billingAccount.findUnique({
        where: { ownerUserId: userId },
        select: {
          payer: true,
          billingEmail: true,
          createdAt: true,
          subscriptions: {
            select: {
              status: true,
              interval: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              canceledAt: true,
            },
          },
          invoices: {
            select: {
              number: true,
              reason: true,
              status: true,
              currency: true,
              totalCents: true,
              amountPaidCents: true,
              issuedAt: true,
              dueAt: true,
              paidAt: true,
              lines: true,
            },
            orderBy: { issuedAt: 'asc' },
          },
          payments: {
            select: {
              status: true,
              amountCents: true,
              currency: true,
              createdAt: true,
              failureCode: true,
              failureMessage: true,
            },
            orderBy: { createdAt: 'asc' },
          },
          // Last four only. The card itself never reached this database —
          // ADR-0006 — and re-exporting the processor's token would put a
          // live payment handle in a file.
          paymentMethods: {
            select: { brand: true, last4: true, expMonth: true, expYear: true },
          },
        },
      }),
      this.prisma.driver.findFirst({
        where: { userId },
        select: {
          displayName: true,
          status: true,
          onShift: true,
          approvedAt: true,
          createdAt: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.caregiver.findUnique({
        where: { userId },
        select: {
          displayName: true,
          bio: true,
          status: true,
          hourlyRateCents: true,
          serviceAreaCity: true,
          serviceAreaState: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      note: 'Everything CareBridge holds about this account. Sign-in credentials, two-factor secrets and recovery codes are deliberately excluded — putting them in a file would be handing out a credential.',
      account: {
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        timeZone: user.timeZone,
        locale: user.locale,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
        simplifiedMode: user.simplifiedMode,
      },
      care,
      consents,
      organizationMemberships: memberships,
      billing: billingAccount,
      driverProfile,
      caregiverProfile,
    };
  }

  // ─── execution, by the sweep ──────────────────────────────────────────────

  /**
   * Called by `RetentionService`. Executes every deletion whose grace period
   * has run out.
   *
   * One transaction per account rather than one for the batch: an erasure that
   * fails on one account — a foreign key nobody anticipated, a lock — must not
   * hold up everybody else's, and must not half-apply. Failures are logged and
   * retried on the next sweep, because the row still says a deletion is due.
   */
  async executeDue(now = new Date()): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: {
        isTombstone: false,
        deletionScheduledFor: { not: null, lte: now },
      },
      select: { id: true },
      take: AccountDeletionService.EXECUTE_BATCH,
    });

    let executed = 0;
    for (const { id } of due) {
      try {
        if (await this.execute(id, now)) executed += 1;
      } catch (error) {
        this.logger.error(
          `Account erasure failed for ${id}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }
    return executed;
  }

  /**
   * One account, erased.
   *
   * The order is the whole correctness argument, and it is not the obvious one:
   *
   *   1. Create the tombstone, so there is something to repoint at.
   *   2. Work out which patients are about to lose their last grant — **before**
   *      the grants are deleted, because afterwards the question is
   *      unanswerable.
   *   3. Repoint and scrub everything marked `anonymise`. This must happen
   *      before the user row goes: four of those relations cascade, so
   *      deleting the user first would take a billing account and seven years
   *      of invoices with it. That failure is one statement in the wrong order
   *      away, which is why ADR-0013 rejected letting the database decide.
   *   4. Delete everything marked `delete`.
   *   5. Archive the orphaned patients and start their own clock.
   *   6. Audit it, attributed to the tombstone so the row outlives the user.
   *   7. Delete the user row. By now nothing points at it.
   */
  private async execute(userId: string, now: Date): Promise<boolean> {
    const email = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          timeZone: true,
          locale: true,
          deletionScheduledFor: true,
          isTombstone: true,
        },
      });

      // Cancelled between the scan and the transaction. Signing in is allowed
      // to win that race — that is what the grace period is for.
      if (!user || user.isTombstone || !user.deletionScheduledFor) return null;
      if (!isDeletionDue(user.deletionScheduledFor, now)) return null;

      // 1 ─── the tombstone
      const tombstoneId = randomUUID();
      const identity = tombstoneIdentity(tombstoneId);
      await tx.user.create({
        data: {
          id: tombstoneId,
          email: identity.email,
          fullName: identity.fullName,
          // Not a hash of anything. Unusable bytes in a NOT NULL column, so no
          // code path can read "no password" as "any password".
          passwordHash: `deleted:${randomBytes(32).toString('base64url')}`,
          isTombstone: true,
          timeZone: user.timeZone,
          locale: user.locale,
        },
      });

      // 2 ─── who loses their last caregiver (ask before deleting the grants)
      const orphanedPatientIds = await this.patientsLosingTheirLastGrant(tx, userId);

      // 3 ─── anonymise
      await this.anonymise(tx, userId, tombstoneId, identity.email, now);

      // 4 ─── delete
      await this.deleteOwned(tx, userId);

      // 5 ─── the patients nobody can reach any more
      for (const patientId of orphanedPatientIds) {
        const patient = await tx.patient.findUnique({
          where: { id: patientId },
          select: { archivedAt: true },
        });
        await tx.patient.update({
          where: { id: patientId },
          data: {
            // The CHECK constraint requires it, and the reason it does is that
            // a patient on a purge clock must not still be visible anywhere.
            archivedAt: patient?.archivedAt ?? now,
            orphanedAt: now,
          },
        });
      }

      // 6 ─── the audit row that survives
      await this.audit.record(
        {
          actorUserId: tombstoneId,
          action: 'auth.account_deleted',
          entityType: 'User',
          entityId: tombstoneId,
          changedFields: orphanedPatientIds.length > 0 ? ['orphanedPatients'] : [],
        },
        tx,
      );

      // 7 ─── the row itself
      await tx.user.delete({ where: { id: userId } });

      return user.email;
    });

    if (email == null) return false;

    // Outside the transaction: the address is gone from the database now, and
    // this is the last thing that will ever be sent to it.
    await this.sendSafely(
      accountDeletedEmail({ appUrl: this.config.PUBLIC_APP_URL }, { to: email }),
    );
    return true;
  }

  /**
   * Patients whose only remaining active grant belongs to this user.
   *
   * A patient is not a user and has no account, so nobody else can ask for
   * this on their behalf once the last grant goes.
   */
  private async patientsLosingTheirLastGrant(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string[]> {
    const grants = await tx.patientAccess.findMany({
      where: { userId, revokedAt: null },
      select: { patientId: true },
    });

    const orphaned: string[] = [];
    for (const { patientId } of grants) {
      const others = await tx.patientAccess.count({
        where: { patientId, revokedAt: null, userId: { not: userId } },
      });
      if (others === 0) orphaned.push(patientId);
    }
    return orphaned;
  }

  /**
   * Everything the disposition table marks `anonymise`.
   *
   * Two things happen per relation, and both are needed: the foreign key is
   * repointed at the tombstone, and any column carrying identity of its own is
   * overwritten. Repointing alone leaves a row that is no longer *linked* to a
   * person while still spelling their name out — see `IDENTIFYING_COLUMNS`.
   */
  private async anonymise(
    tx: Prisma.TransactionClient,
    userId: string,
    tombstoneId: string,
    tombstoneEmail: string,
    now: Date,
  ): Promise<void> {
    // Audit rows. Not a relation at all — `AuditLog.actorUserId` is a bare
    // column with no foreign key, which is why no cascade could ever have
    // reached it and why this is a plain update.
    await tx.auditLog.updateMany({
      where: { actorUserId: userId },
      data: { actorUserId: tombstoneId },
    });

    // Money. Seven years. The FK cascades, so this must precede the delete.
    await tx.billingAccount.updateMany({
      where: { ownerUserId: userId },
      data: { ownerUserId: tombstoneId, billingEmail: tombstoneEmail },
    });

    // Consent: evidence that it was given, which is our own defence.
    await tx.userConsent.updateMany({
      where: { userId },
      data: { userId: tombstoneId },
    });

    // Membership: revoked first, because the person is gone and an active
    // membership on a tombstone would say somebody may still see the queue.
    await tx.organizationMembership.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.organizationMembership.updateMany({
      where: { userId },
      data: { userId: tombstoneId },
    });

    await tx.seatLedgerEntry.updateMany({
      where: { actorUserId: userId },
      data: { actorUserId: tombstoneId },
    });

    // Administrative acts. The act is the record; the actor's identity is not
    // what makes it meaningful. An approval that loses its actor is still an
    // approval that happened.
    await tx.driver.updateMany({
      where: { approvedByUserId: userId },
      data: { approvedByUserId: tombstoneId },
    });
    await tx.driverDocument.updateMany({
      where: { reviewedByUserId: userId },
      data: { reviewedByUserId: tombstoneId },
    });
    await tx.refund.updateMany({
      where: { requestedByUserId: userId },
      data: { requestedByUserId: tombstoneId },
    });
    await tx.featureFlag.updateMany({
      where: { updatedByUserId: userId },
      data: { updatedByUserId: tombstoneId },
    });
    await tx.bookingDispute.updateMany({
      where: { resolvedByUserId: userId },
      data: { resolvedByUserId: tombstoneId },
    });

    // The person's own service history.
    await tx.bookingDispute.updateMany({
      where: { raisedByUserId: userId },
      data: { raisedByUserId: tombstoneId },
    });
    await tx.caregiverBooking.updateMany({
      where: { bookedByUserId: userId },
      data: { bookedByUserId: tombstoneId },
    });
    await tx.caregiverReview.updateMany({
      where: { authorUserId: userId },
      data: { authorUserId: tombstoneId },
    });
    await tx.caregiver.updateMany({
      where: { userId },
      data: {
        userId: tombstoneId,
        displayName: 'Former caregiver',
        // Written by the person, about the person.
        bio: '',
      },
    });

    // Invitations this user *accepted*: the address on the row is their own.
    await tx.patientInvitation.updateMany({
      where: { acceptedByUserId: userId },
      data: { acceptedByUserId: tombstoneId, email: tombstoneEmail },
    });

    // Invitations this user *sent*. Unaccepted ones are live capabilities and
    // must not outlive the inviter; accepted ones are the history of how a
    // grant that still exists came to be. Delete then repoint, so only the
    // accepted remain to repoint — and note the email on these is the
    // *invitee's*, not this user's, so it is left alone.
    await tx.patientInvitation.deleteMany({
      where: { invitedByUserId: userId, acceptedAt: null },
    });
    await tx.patientInvitation.updateMany({
      where: { invitedByUserId: userId },
      data: { invitedByUserId: tombstoneId },
    });

    // Messages: the words stay in the other side's record; the name on them
    // does not. The label is frozen at send time, so it is overwritten as well
    // as repointed — otherwise every message would still say "Sarah (daughter)".
    await tx.message.updateMany({
      where: { senderUserId: userId },
      data: { senderUserId: tombstoneId, senderLabel: 'Former member' },
    });
    await tx.callSession.updateMany({
      where: { initiatedByUserId: userId },
      data: { initiatedByUserId: tombstoneId },
    });

    await this.anonymiseDriverProfile(tx, userId, tombstoneId, now);
  }

  /**
   * The driver record belongs to the operator, not to the account.
   *
   * So it survives — completed rides still have to name a driver — but it stops
   * naming a person and stops being linked to one. `userId` is set to null
   * rather than to the tombstone because the accurate statement is that this
   * driver record no longer corresponds to any account at all.
   *
   * Offboarding is not optional here: an approved driver occupies a **billable
   * seat**, and leaving one on an operator's bill for a person who no longer
   * exists is the error that ends a contract. `recordSeatChange` runs inside
   * this transaction, exactly as it does when an administrator offboards
   * somebody, so the erasure cannot leave an operator billed-but-offboarded.
   */
  private async anonymiseDriverProfile(
    tx: Prisma.TransactionClient,
    userId: string,
    tombstoneId: string,
    now: Date,
  ): Promise<void> {
    const driver = await tx.driver.findFirst({
      where: { userId },
      select: { id: true, organizationId: true, status: true },
    });
    if (!driver) return;

    const wasBilled = occupiesSeat(driver.status);

    await tx.driver.update({
      where: { id: driver.id },
      data: {
        userId: null,
        invitedEmail: null,
        phone: null,
        rejectionReason: null,
        displayName: 'Former driver',
        status: 'offboarded',
        deactivatedAt: now,
        onShift: false,
      },
    });

    if (wasBilled) {
      await this.billing.recordSeatChange({
        db: tx,
        organizationId: driver.organizationId,
        driverId: driver.id,
        change: 'released',
        actorUserId: tombstoneId,
        now,
      });
    }
  }

  /** Everything the disposition table marks `delete`. */
  private async deleteOwned(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.credentialToken.deleteMany({ where: { userId } });
    await tx.userMfa.deleteMany({ where: { userId } });
    await tx.deviceToken.deleteMany({ where: { userId } });
    await tx.notificationPreference.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.conversationReadState.deleteMany({ where: { userId } });
    await tx.idempotencyRecord.deleteMany({ where: { userId } });
    // Last of the deletes: `patientsLosingTheirLastGrant` has already been
    // asked, and after this the question cannot be answered.
    await tx.patientAccess.deleteMany({ where: { userId } });
  }

  /**
   * Orphaned patients whose own thirty days have run out.
   *
   * A purge empties the record; it does not delete the row. `Ride.patientId`
   * is `ON DELETE CASCADE`, so removing the patient would take every completed
   * ride and its fare with it — the one thing "delete my account" must not
   * mean. The ride's pickup and destination are separate rows copied at
   * booking, so scrubbing the patient's home address cannot rewrite where a
   * journey actually went.
   *
   * Emergency contacts are deleted outright rather than scrubbed: they are a
   * third party's name and phone number, held only to be rung during a
   * journey, and there are no journeys left.
   */
  async purgeOrphanedPatients(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - PATIENT_PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    const due = await this.prisma.patient.findMany({
      where: { purgedAt: null, orphanedAt: { not: null, lte: cutoff } },
      select: { id: true, homeAddressId: true },
      take: AccountDeletionService.EXECUTE_BATCH,
    });

    let purged = 0;
    for (const patient of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.emergencyContact.deleteMany({ where: { patientId: patient.id } });

          await tx.address.update({
            where: { id: patient.homeAddressId },
            data: {
              label: 'Removed',
              line1: 'Removed',
              line2: null,
              city: 'Removed',
              state: '--',
              postalCode: '00000',
              accessNotes: null,
              latitude: null,
              longitude: null,
              geocodePrecision: null,
              geocodeSource: null,
              geocodedAt: null,
            },
          });

          await tx.patient.update({
            where: { id: patient.id },
            data: {
              preferredName: 'Removed',
              legalName: null,
              phone: '',
              // Operational, never diagnostic — but still a description of a
              // person's body, and nothing left needs it.
              mobilityNeeds: [],
              mobilityNotes: null,
              preferredLanguage: 'Unknown',
              ageBand: null,
              preferredClinicId: null,
              purgedAt: now,
            },
          });

          await this.audit.record(
            {
              actorUserId: null,
              action: 'care.patient_purged',
              entityType: 'Patient',
              entityId: patient.id,
              changedFields: ['preferredName', 'legalName', 'phone', 'homeAddress'],
            },
            tx,
          );
        });
        purged += 1;
      } catch (error) {
        this.logger.error(
          `Patient purge failed for ${patient.id}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }
    return purged;
  }

  /**
   * A failed email must not fail the deletion.
   *
   * The state change is the thing the person asked for; the message about it is
   * a courtesy. Losing the request because a mail vendor was down would be the
   * worse outcome, and the audit row records what happened either way.
   */
  private async sendSafely(message: Parameters<MailPort['send']>[0]): Promise<void> {
    try {
      await this.mail.send(message);
    } catch (error) {
      this.logger.error(
        `Deletion email failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

/** "17 October 2026" — a date a person reads, not an instant a machine parses. */
function formatDate(at: Date): string {
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
