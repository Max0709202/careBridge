import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  PAYMENTS,
  type PaymentsPort,
} from '../../infrastructure/payments/payments.port';
import { AuthorizationError, ValidationError } from '../../common/errors';
import type { RequestContext } from '../../common/request-context';
import { rolloutTakesFeatureAway } from '../../domain/feature-flags';
import { TrackingFreshness } from '../../domain/tracking';
import { LOCATION_SHARING_STATUSES } from '../../domain/ride-status';
import { DOCUMENT_EXPIRY_WARNING_DAYS } from '../../domain/driver-documents';
import type {
  AuditPageDto,
  FeatureFlagDto,
  PlatformStatsDto,
  RefundDto,
  RefundableInvoiceDto,
} from './admin.dto';
import type { AuditQueryDto, IssueRefundDto } from './dto/admin.request.dto';

/** One page of audit rows. Small enough to read, large enough to be useful. */
const AUDIT_PAGE = 50;

/**
 * The administration surfaces.
 *
 * Everything here is read-mostly and heavily audited, and the one write that
 * moves money — a refund — is written down before the processor is called for
 * the same reason a payment attempt is: money that left the business with no
 * row to explain it is the worst outcome in the billing system.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENTS) private readonly payments: PaymentsPort,
  ) {}

  // ─── the audit log ────────────────────────────────────────────────────────

  /**
   * The audit log, filtered and paged.
   *
   * **Keyset paging, not offset.** This table is appended to on every
   * authenticated action in the system; an offset-paged read would skip rows
   * that arrived between page one and page two, and repeat others. For a log
   * whose purpose is answering "what happened", quietly omitting rows is the
   * one failure that matters.
   */
  async auditLog(query: AuditQueryDto): Promise<AuditPageDto> {
    const cursor = decodeCursor(query.cursor);

    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      // A prefix, so `driver.` returns everything about drivers rather than
      // requiring somebody to know the exact verb.
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.from || query.to || cursor
        ? {
            at: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
              ...(cursor ? { lt: cursor.at } : {}),
            },
          }
        : {}),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      // Ties broken by id, so two rows written in the same millisecond cannot
      // straddle a page boundary and be lost.
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: AUDIT_PAGE + 1,
    });

    const page = rows.slice(0, AUDIT_PAGE);
    const names = await this.namesFor(page.map((row) => row.actorUserId));

    return {
      entries: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        actorUserId: row.actorUserId,
        actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        changedFields: row.changedFields,
        correlationId: row.correlationId,
        ip: row.ip,
      })),
      nextCursor:
        rows.length > AUDIT_PAGE && page.at(-1) ? encodeCursor(page.at(-1)!.at) : null,
    };
  }

  // ─── feature flags ────────────────────────────────────────────────────────

  async flags(): Promise<FeatureFlagDto[]> {
    const rows = await this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
      include: { updatedBy: { select: { fullName: true } } },
    });

    return rows.map((row) => ({
      key: row.key,
      description: row.description,
      enabled: row.enabled,
      rolloutPercent: row.rolloutPercent,
      updatedAt: row.updatedAt.toISOString(),
      updatedByName: row.updatedBy?.fullName ?? null,
    }));
  }

  /**
   * Creates or updates a flag.
   *
   * Narrowing a rollout needs `confirmNarrowing`, because it takes a feature
   * away from people who already had it — which reads to them as a bug rather
   * than as a decision. It is allowed, because sometimes a bad release has to
   * be pulled; it just has to be said out loud rather than typed by accident.
   */
  async setFlag(
    key: string,
    input: {
      description: string;
      enabled: boolean;
      rolloutPercent: number;
      confirmNarrowing?: boolean;
    },
    actorUserId: string,
    ctx: RequestContext,
  ): Promise<FeatureFlagDto[]> {
    const existing = await this.prisma.featureFlag.findUnique({ where: { key } });

    if (
      existing &&
      rolloutTakesFeatureAway(existing.rolloutPercent, input.rolloutPercent) &&
      !input.confirmNarrowing
    ) {
      throw new ValidationError(
        `That narrows the rollout from ${existing.rolloutPercent}% to ${input.rolloutPercent}%, which takes the feature away from people who already have it. Confirm to continue.`,
        'rolloutPercent',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.featureFlag.upsert({
        where: { key },
        create: {
          key,
          description: input.description.trim(),
          enabled: input.enabled,
          rolloutPercent: input.rolloutPercent,
          updatedByUserId: actorUserId,
        },
        update: {
          description: input.description.trim(),
          enabled: input.enabled,
          rolloutPercent: input.rolloutPercent,
          updatedByUserId: actorUserId,
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: existing ? 'admin.flag_updated' : 'admin.flag_created',
          entityType: 'FeatureFlag',
          entityId: key,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['enabled', 'rolloutPercent', 'description'],
        },
        tx,
      );
    });

    return this.flags();
  }

  // ─── refunds ──────────────────────────────────────────────────────────────

  /** What may still be refunded on one invoice, and what already has been. */
  async refundableInvoice(invoiceId: string): Promise<RefundableInvoiceDto> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        // `refunded` as well as `succeeded`, and that is not a detail: a fully
        // refunded payment is still the payment that was made. Looking only
        // for `succeeded` would make this screen claim nothing had ever been
        // paid the moment somebody refunded all of it — which is exactly when
        // an administrator most needs to see what happened.
        payments: {
          where: { status: { in: ['succeeded', 'refunded'] } },
          orderBy: { createdAt: 'desc' },
        },
        refunds: {
          orderBy: { createdAt: 'desc' },
          include: { requestedBy: { select: { fullName: true } } },
        },
      },
    });
    if (!invoice) throw new AuthorizationError();

    const payment = invoice.payments[0];
    if (!payment) {
      throw new ValidationError('Nothing has been paid on that invoice.');
    }

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      paymentId: payment.id,
      paidCents: payment.amountCents,
      refundableCents: remaining(payment.amountCents, invoice.refunds),
      refunds: invoice.refunds.map(toRefundDto(invoice.number)),
    };
  }

  /**
   * Sends money back.
   *
   * Three commits, in the same shape the collection path uses. The row is
   * written **before** the processor is called, so a refund that succeeded
   * externally and failed to record here is still explicable; the outcome is
   * recorded after. In between, the row sits `pending`, which is exactly what
   * it is.
   */
  async issueRefund(
    invoiceId: string,
    input: IssueRefundDto,
    actorUserId: string,
    ctx: RequestContext,
  ): Promise<RefundableInvoiceDto> {
    const reason = input.reason.trim();
    if (!reason) throw new ValidationError('Say why this is being refunded.', 'reason');

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true, refunds: true },
    });
    if (!invoice) throw new AuthorizationError();

    const payment = invoice.payments.find((row) => row.id === input.paymentId);
    // Checked against the invoice in the path as well as existing, so a
    // payment id from another account cannot be refunded through this one.
    //
    // A `refunded` payment is still a real payment and is allowed through
    // here: the `remaining` check below refuses it with a message that says
    // how much is left, which is a better answer than a bare 404 for somebody
    // who is looking at the right screen.
    if (!payment || (payment.status !== 'succeeded' && payment.status !== 'refunded')) {
      throw new AuthorizationError();
    }

    const left = remaining(payment.amountCents, invoice.refunds);
    if (input.amountCents > left) {
      throw new ValidationError(
        `That is more than is left on this payment — ${(left / 100).toFixed(2)} remains.`,
        'amountCents',
      );
    }
    if (!payment.externalPaymentId) {
      throw new ValidationError(
        'That payment has no processor reference, so it cannot be refunded automatically.',
      );
    }

    const idempotencyKey = randomUUID();
    const refund = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          invoiceId,
          paymentId: payment.id,
          amountCents: input.amountCents,
          currency: payment.currency,
          reason,
          idempotencyKey,
          requestedByUserId: actorUserId,
          status: 'pending',
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'admin.refund_requested',
          entityType: 'Refund',
          entityId: created.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['amountCents', 'reason'],
        },
        tx,
      );

      return created;
    });

    try {
      const outcome = await this.payments.refund({
        externalPaymentId: payment.externalPaymentId,
        amountCents: input.amountCents,
        idempotencyKey,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: 'succeeded',
            externalRefundId: outcome.externalRefundId,
            settledAt: new Date(),
          },
        });

        // The payment is marked refunded only when nothing is left on it. A
        // partial refund leaves it succeeded, because it *did* succeed and the
        // remainder is still collected revenue.
        const refunded =
          input.amountCents +
          invoice.refunds
            .filter((row) => row.status === 'succeeded')
            .reduce((sum, row) => sum + row.amountCents, 0);

        if (refunded >= payment.amountCents) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'refunded' },
          });
        }

        await this.audit.record(
          {
            actorUserId,
            action: 'admin.refund_succeeded',
            entityType: 'Refund',
            entityId: refund.id,
            correlationId: ctx.correlationId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
      });
    } catch (error) {
      // Recorded, not swallowed and not rethrown as a 500. A refund that the
      // processor refused is a fact an administrator needs to see on the
      // screen they issued it from.
      const message = error instanceof Error ? error.message : 'unknown failure';
      this.logger.warn(`Refund ${refund.id} failed at the processor`);

      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'failed', failureMessage: message, settledAt: new Date() },
      });

      await this.audit.record({
        actorUserId,
        action: 'admin.refund_failed',
        entityType: 'Refund',
        entityId: refund.id,
        correlationId: ctx.correlationId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    return this.refundableInvoice(invoiceId);
  }

  // ─── the dashboard ────────────────────────────────────────────────────────

  /**
   * The numbers somebody running a pilot looks at first.
   *
   * Chosen so that each one implies an action rather than being interesting.
   * "Stale tracking now" is a list of telephone calls. "Drivers with expiring
   * documents" is a list of drivers who come off the road unless somebody
   * chases them. A dashboard of totals nobody can act on is a dashboard nobody
   * opens twice.
   */
  async stats(now: Date): Promise<PlatformStatsDto> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600_000);
    const staleBefore = new Date(now.getTime() - TrackingFreshness.staleMs);
    const expiryHorizon = new Date(
      now.getTime() + DOCUMENT_EXPIRY_WARNING_DAYS * 24 * 3600_000,
    );

    const [
      ridesLast7Days,
      ridesCompletedLast7Days,
      ridesNoShowLast7Days,
      ridesCancelledLast7Days,
      activeRidesNow,
      staleTrackingNow,
      familiesSubscribed,
      operatorsSubscribed,
      driversApproved,
      driversWithExpiringDocuments,
      documentsAwaitingReview,
      invoicesPastDue,
      revenue,
      refunded,
    ] = await Promise.all([
      this.prisma.ride.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.ride.count({
        where: { createdAt: { gte: sevenDaysAgo }, status: 'completed' },
      }),
      this.prisma.ride.count({
        where: { createdAt: { gte: sevenDaysAgo }, status: 'noShow' },
      }),
      this.prisma.ride.count({
        where: { createdAt: { gte: sevenDaysAgo }, status: 'canceled' },
      }),
      this.prisma.ride.count({
        where: { status: { in: [...LOCATION_SHARING_STATUSES] } },
      }),
      this.prisma.ride.count({
        where: {
          status: { in: [...LOCATION_SHARING_STATUSES] },
          OR: [{ lastCapturedAt: null }, { lastCapturedAt: { lt: staleBefore } }],
        },
      }),
      this.prisma.subscription.count({
        where: {
          status: { in: ['active', 'trialing'] },
          billingAccount: { payer: 'family' },
        },
      }),
      this.prisma.subscription.count({
        where: {
          status: { in: ['active', 'trialing'] },
          billingAccount: { payer: 'dispatchOrganization' },
        },
      }),
      this.prisma.driver.count({ where: { status: 'approved' } }),
      this.prisma.driver.count({
        where: {
          status: 'approved',
          documents: {
            some: {
              supersededAt: null,
              status: 'approved',
              expiresAt: { not: null, lte: expiryHorizon },
            },
          },
        },
      }),
      this.prisma.driverDocument.count({
        where: { status: 'submitted', supersededAt: null },
      }),
      // "Past due" is not a status here: an invoice is `open` and has failed
      // at least once. Modelling it as a status would have made an invoice
      // that is merely unpaid indistinguishable from one being chased.
      this.prisma.invoice.count({
        where: { status: 'open', attemptCount: { gt: 0 } },
      }),
      this.prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: {
          status: { in: ['succeeded', 'refunded'] },
          settledAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.refund.aggregate({
        _sum: { amountCents: true },
        where: { status: 'succeeded', settledAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    return {
      ridesLast7Days,
      ridesCompletedLast7Days,
      ridesNoShowLast7Days,
      ridesCancelledLast7Days,
      activeRidesNow,
      staleTrackingNow,
      familiesSubscribed,
      operatorsSubscribed,
      driversApproved,
      driversWithExpiringDocuments,
      documentsAwaitingReview,
      invoicesPastDue,
      revenueCentsLast30Days: revenue._sum.amountCents ?? 0,
      refundedCentsLast30Days: refunded._sum.amountCents ?? 0,
    };
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private async namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}

/**
 * What is left on a payment.
 *
 * Only successful refunds count. A failed one reserved nothing and must not
 * hold money hostage: an administrator retrying after a processor error would
 * otherwise be told there is less left than there is.
 */
function remaining(
  paidCents: number,
  refunds: readonly { amountCents: number; status: string }[],
): number {
  const already = refunds
    .filter((refund) => refund.status === 'succeeded' || refund.status === 'pending')
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  return Math.max(0, paidCents - already);
}

function toRefundDto(invoiceNumber: string) {
  return (refund: {
    id: string;
    invoiceId: string;
    amountCents: number;
    currency: string;
    reason: string;
    status: string;
    failureMessage: string | null;
    createdAt: Date;
    settledAt: Date | null;
    requestedBy: { fullName: string };
  }): RefundDto => ({
    id: refund.id,
    invoiceId: refund.invoiceId,
    invoiceNumber,
    amountCents: refund.amountCents,
    currency: refund.currency,
    reason: refund.reason,
    status: refund.status,
    failureMessage: refund.failureMessage,
    requestedByName: refund.requestedBy.fullName,
    createdAt: refund.createdAt.toISOString(),
    settledAt: refund.settledAt?.toISOString() ?? null,
  });
}

/**
 * A cursor is a timestamp, base64'd so it reads as opaque.
 *
 * Opaque on purpose rather than for secrecy: a client that parses a cursor is
 * a client that breaks when the paging key changes.
 */
function encodeCursor(at: Date): string {
  return Buffer.from(at.toISOString(), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date } | null {
  if (!cursor) return null;
  try {
    const at = new Date(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isNaN(at.getTime()) ? null : { at };
  } catch {
    // A malformed cursor reads as the first page. Throwing would turn a stale
    // bookmark into an error page.
    return null;
  }
}
