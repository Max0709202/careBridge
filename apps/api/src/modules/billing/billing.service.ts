import { Injectable } from '@nestjs/common';
import type { BillingInterval, Prisma, SubscriptionStatus } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors';
import { Money } from '../../domain/money';
import {
  assertSubscriptionTransition,
  hasEntitlement,
  periodEndFor,
  trialEndsAt,
  type Entitlement,
} from '../../domain/billing';
import {
  quoteIntervalSwitch,
  quoteSeatChange,
  quoteSubscription,
  type SubscriptionQuote,
} from '../../domain/subscription-pricing';
import type {
  BillingAccountDto,
  OrganizationSeatsDto,
  SubscriptionDto,
  SubscriptionPlanDto,
  SubscriptionQuoteDto,
} from './billing.dto';
import {
  PLAN_INCLUDE,
  SUBSCRIPTION_INCLUDE,
  toEntitlementState,
  toPlanDomain,
  toPlanDto,
  toQuoteDto,
  toSeatLedgerDto,
  toStoredLines,
  type PlanRow,
  type SubscriptionRow,
} from './billing.mapper';

type Db = PrismaService | Prisma.TransactionClient;

/** Statuses that mean "this is the subscription in force". */
const LIVE_STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'pastDue',
  'pendingCancellation',
];

/**
 * The two revenue lines, in one service.
 *
 * A family and a dispatch operator are different buyers having different
 * renewal conversations, but they are billed by the same mechanism — plan row,
 * period, status, entitlements — and this service is deliberately the only
 * implementation of it. The alternative, a `FamilyBillingService` beside an
 * `OperatorBillingService`, ends with two answers to "is this entitling right
 * now" and the disagreement is either a family locked out of a live trip or an
 * operator using a console they stopped paying for.
 *
 * What is *not* here is the money movement. Charging a card is Stage 4 and
 * ADR-0006; every quote below is computed, recorded and stamped with the plan
 * version that produced it, and the amounts are handed to the processor there.
 * The seam is `SubscriptionPeriod` — an unpaid period is a period with no
 * payment against it, not a missing row.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
  ) {}

  // ─── the catalogue ────────────────────────────────────────────────────────

  async plans(
    payer: 'family' | 'dispatchOrganization',
  ): Promise<SubscriptionPlanDto[]> {
    const rows = await this.prisma.subscriptionPlan.findMany({
      where: { payer, active: true, effectiveFrom: { lte: new Date() } },
      include: PLAN_INCLUDE,
      orderBy: [{ code: 'asc' }, { interval: 'asc' }],
    });
    return rows.map(toPlanDto);
  }

  /**
   * The plan in force for a code and interval.
   *
   * Absent means the catalogue was not seeded, which is an operator error
   * worth failing loudly on rather than papering over with a made-up price —
   * the same call `CareService.activePricingRule` makes about a missing
   * pricing rule.
   */
  private async requirePlan(
    payer: 'family' | 'dispatchOrganization',
    code: string,
    interval: BillingInterval,
    db: Db = this.prisma,
  ): Promise<PlanRow> {
    const plan = await db.subscriptionPlan.findFirst({
      where: {
        payer,
        code,
        interval,
        active: true,
        effectiveFrom: { lte: new Date() },
      },
      include: PLAN_INCLUDE,
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!plan) throw new NotFoundError();
    return plan;
  }

  /** The cheapest live plan for a payer. What a trial starts on. */
  private async defaultPlan(
    payer: 'family' | 'dispatchOrganization',
    db: Db = this.prisma,
  ): Promise<PlanRow> {
    const plan = await db.subscriptionPlan.findFirst({
      where: {
        payer,
        interval: 'monthly',
        active: true,
        effectiveFrom: { lte: new Date() },
      },
      include: PLAN_INCLUDE,
      orderBy: [{ basePriceCents: 'asc' }, { effectiveFrom: 'desc' }],
    });
    if (!plan) throw new NotFoundError();
    return plan;
  }

  // ─── accounts ─────────────────────────────────────────────────────────────

  private async familyAccount(userId: string, db: Db = this.prisma) {
    return db.billingAccount.findUnique({ where: { ownerUserId: userId } });
  }

  /**
   * Starts a household's trial, at registration.
   *
   * A trial rather than an unbilled free tier, because the fee model has to be
   * true from the first ride: a family that never sees a plan, a renewal date
   * or a price has no way to discover what this costs until the day it stops
   * working. Fourteen days is the plan's, not this code's.
   *
   * Idempotent — a retried registration must not start a second trial.
   */
  async startFamilyTrial(
    userId: string,
    email: string,
    now: Date,
    db: Db = this.prisma,
  ): Promise<void> {
    const existing = await this.familyAccount(userId, db);
    if (existing) return;

    const plan = await this.defaultPlan('family', db);

    const account = await db.billingAccount.create({
      data: { payer: 'family', ownerUserId: userId, billingEmail: email },
    });

    await this.openSubscription({
      db,
      billingAccountId: account.id,
      plan,
      seats: 0,
      status: plan.trialDays > 0 ? 'trialing' : 'active',
      now,
    });
  }

  /**
   * Opens a subscription and its first period in one go.
   *
   * The period row is written at the same moment as the subscription, not
   * lazily at the first renewal, because it is the record of what was quoted:
   * plan code, plan version, seat count and the itemisation, copied rather
   * than joined so a superseded plan cannot rewrite history.
   */
  private async openSubscription(input: {
    db: Db;
    billingAccountId: string;
    plan: PlanRow;
    seats: number;
    status: SubscriptionStatus;
    now: Date;
  }): Promise<SubscriptionRow> {
    const { db, billingAccountId, plan, seats, status, now } = input;

    const domainPlan = toPlanDomain(plan);
    const quote = quoteSubscription({ plan: domainPlan, seats });
    const periodEnd = periodEndFor(now, plan.interval);

    const subscription = await db.subscription.create({
      data: {
        billingAccountId,
        planId: plan.id,
        status,
        interval: plan.interval,
        seats,
        seatsPaidFor: seats,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: status === 'trialing' ? trialEndsAt(now, plan.trialDays) : null,
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    await this.writePeriod(db, subscription.id, 0, now, periodEnd, quote);
    return subscription;
  }

  private async writePeriod(
    db: Db,
    subscriptionId: string,
    sequence: number,
    startsAt: Date,
    endsAt: Date,
    quote: SubscriptionQuote,
  ): Promise<void> {
    const base = quote.lines[0]?.amount ?? Money.zero();
    await db.subscriptionPeriod.create({
      data: {
        subscriptionId,
        sequence,
        startsAt,
        endsAt,
        planCode: quote.planCode,
        planVersion: quote.planVersion,
        interval: quote.interval,
        seatsBilled: quote.seats,
        basePriceCents: base.cents,
        seatChargeCents: quote.total.cents - base.cents,
        totalCents: quote.total.cents,
        lines: toStoredLines(quote),
      },
    });
  }

  // ─── reading ──────────────────────────────────────────────────────────────

  private liveSubscription(
    billingAccountId: string,
    db: Db = this.prisma,
  ): Promise<SubscriptionRow | null> {
    return db.subscription.findFirst({
      where: { billingAccountId, status: { in: LIVE_STATUSES } },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  /** The family account and its subscription, as the app renders them. */
  async familyBilling(userId: string): Promise<BillingAccountDto | null> {
    const account = await this.familyAccount(userId);
    if (!account) return null;

    const subscription = await this.liveSubscription(account.id);

    return {
      id: account.id,
      payer: account.payer,
      billingEmail: account.billingEmail,
      organizationId: null,
      subscription: subscription ? this.toSubscriptionDto(subscription) : null,
    };
  }

  async organizationBilling(
    userId: string,
    organizationId: string,
  ): Promise<BillingAccountDto> {
    await this.organizations.requireMembership(userId, organizationId, [
      'owner',
      'admin',
    ]);

    const account = await this.prisma.billingAccount.findUnique({
      where: { organizationId },
    });
    if (!account) throw new NotFoundError();

    const subscription = await this.liveSubscription(account.id);

    return {
      id: account.id,
      payer: account.payer,
      billingEmail: account.billingEmail,
      organizationId,
      subscription: subscription ? this.toSubscriptionDto(subscription) : null,
    };
  }

  private toSubscriptionDto(row: SubscriptionRow): SubscriptionDto {
    const now = new Date();
    const state = toEntitlementState(row);

    return {
      id: row.id,
      payer: row.billingAccount.payer,
      status: row.status,
      interval: row.interval,
      planCode: row.plan.code,
      planName: row.plan.name,
      planVersion: row.plan.version,
      seats: row.seats,
      currentPeriodStart: row.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      pastDueSince: row.pastDueSince?.toISOString() ?? null,
      cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
      // Resolved here, never on the client. The Dart mirror of these rules
      // exists so a button can be greyed out before the request is made; it
      // cannot authorise anything.
      entitlements: [...activeOrEmpty(state, now)],
      carriedCreditCents: row.carriedCreditCents,
      renewalQuote: toQuoteDto(
        quoteSubscription({ plan: toPlanDomain(row.plan), seats: row.seats }),
      ),
    };
  }

  // ─── entitlements ─────────────────────────────────────────────────────────

  /**
   * Whether a household may do something right now.
   *
   * Called on the write path, not only when rendering. The client's copy of
   * these rules hides controls; this is the control.
   */
  async familyHasEntitlement(
    userId: string,
    entitlement: Entitlement,
    now = new Date(),
    db: Db = this.prisma,
  ): Promise<boolean> {
    const account = await db.billingAccount.findUnique({
      where: { ownerUserId: userId },
    });
    if (!account) return false;

    const subscription = await this.liveSubscription(account.id, db);
    if (!subscription) return false;

    return hasEntitlement(toEntitlementState(subscription), entitlement, now);
  }

  /**
   * Whether the operator behind a driver is paying by seats.
   *
   * This is the branch `settleFare` turns on: an operator on a subscription
   * keeps the whole fare, because taking a per-ride percentage as well would
   * be charging twice for one relationship.
   */
  async organizationHasEntitlement(
    organizationId: string,
    entitlement: Entitlement,
    now = new Date(),
    db: Db = this.prisma,
  ): Promise<boolean> {
    const account = await db.billingAccount.findUnique({ where: { organizationId } });
    if (!account) return false;

    const subscription = await this.liveSubscription(account.id, db);
    if (!subscription) return false;

    return hasEntitlement(toEntitlementState(subscription), entitlement, now);
  }

  // ─── changing a subscription ──────────────────────────────────────────────

  async subscribeFamily(
    userId: string,
    input: { planCode: string; interval: BillingInterval },
    context: { correlationId?: string | null },
  ): Promise<BillingAccountDto> {
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundError();

      const plan = await this.requirePlan('family', input.planCode, input.interval, tx);

      const account =
        (await this.familyAccount(userId, tx)) ??
        (await tx.billingAccount.create({
          data: { payer: 'family', ownerUserId: userId, billingEmail: user.email },
        }));

      await this.replaceOrOpen({ tx, accountId: account.id, plan, seats: 0, now });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'billing.subscribe',
          entityType: 'BillingAccount',
          entityId: account.id,
          correlationId: context.correlationId,
          changedFields: ['planId', 'interval', 'status'],
        },
        tx,
      );
    });

    const billing = await this.familyBilling(userId);
    if (!billing) throw new NotFoundError();
    return billing;
  }

  async subscribeOrganization(
    userId: string,
    organizationId: string,
    input: { planCode: string; interval: BillingInterval },
    context: { correlationId?: string | null },
  ): Promise<BillingAccountDto> {
    await this.organizations.requireMembership(userId, organizationId, [
      'owner',
      'admin',
    ]);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
      });
      if (!organization || organization.archivedAt) throw new NotFoundError();

      const plan = await this.requirePlan(
        'dispatchOrganization',
        input.planCode,
        input.interval,
        tx,
      );

      const account =
        (await tx.billingAccount.findUnique({ where: { organizationId } })) ??
        (await tx.billingAccount.create({
          data: {
            payer: 'dispatchOrganization',
            organizationId,
            billingEmail: organization.contactEmail,
          },
        }));

      // Priced at the drivers actually on the road. An operator cannot
      // subscribe at five seats and run twenty.
      const seats = await this.organizations.activeDriverCount(organizationId, tx);

      await this.replaceOrOpen({ tx, accountId: account.id, plan, seats, now });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'billing.subscribe',
          entityType: 'BillingAccount',
          entityId: account.id,
          correlationId: context.correlationId,
          changedFields: ['planId', 'interval', 'seats', 'status'],
        },
        tx,
      );
    });

    return this.organizationBilling(userId, organizationId);
  }

  /**
   * A billing account holds at most one live subscription — enforced by a
   * partial unique index, because "which subscription is in force" having more
   * than one answer is how an entitlement check starts depending on row order.
   *
   * Re-subscribing while one is live is refused rather than silently replacing
   * it: switching plan is `changeInterval`, and anything else is two
   * intentions sharing an endpoint.
   */
  private async replaceOrOpen(input: {
    tx: Prisma.TransactionClient;
    accountId: string;
    plan: PlanRow;
    seats: number;
    now: Date;
  }): Promise<void> {
    const { tx, accountId, plan, seats, now } = input;

    const live = await this.liveSubscription(accountId, tx);
    if (live) {
      throw new ConflictError(
        'This account already has a subscription. Change its plan or cancel it first.',
      );
    }

    await this.openSubscription({
      db: tx,
      billingAccountId: accountId,
      plan,
      seats,
      status: plan.trialDays > 0 ? 'trialing' : 'active',
      now,
    });
  }

  /**
   * Monthly ⇄ annual.
   *
   * The current period is credited for its unused remainder and a fresh period
   * starts today. Annual → monthly therefore usually produces a *credit*
   * carried against renewals rather than a refund — money already taken stays
   * taken, and saying so plainly beats a support queue asking where the refund
   * went.
   */
  async changeInterval(
    userId: string,
    scope: { organizationId?: string },
    interval: BillingInterval,
    context: { correlationId?: string | null },
  ): Promise<BillingAccountDto> {
    if (scope.organizationId) {
      await this.organizations.requireMembership(userId, scope.organizationId, [
        'owner',
        'admin',
      ]);
    }
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const account = scope.organizationId
        ? await tx.billingAccount.findUnique({
            where: { organizationId: scope.organizationId },
          })
        : await tx.billingAccount.findUnique({ where: { ownerUserId: userId } });
      if (!account) throw new NotFoundError();

      const current = await this.liveSubscription(account.id, tx);
      if (!current) throw new NotFoundError();
      if (current.interval === interval) {
        throw new ValidationError('That is already the billing interval.', 'interval');
      }

      const target = await this.requirePlan(
        account.payer,
        current.plan.code,
        interval,
        tx,
      );

      const quote = quoteIntervalSwitch({
        from: toPlanDomain(current.plan),
        to: toPlanDomain(target),
        seats: current.seats,
        periodStart: current.currentPeriodStart,
        periodEnd: current.currentPeriodEnd,
        effectiveAt: now,
      });

      const periodEnd = periodEndFor(now, interval);

      await tx.subscription.update({
        where: { id: current.id },
        data: {
          planId: target.id,
          interval,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          // A new period starts, so the high-water mark starts again with it.
          seatsPaidFor: current.seats,
          carriedCreditCents: current.carriedCreditCents + quote.carriedCredit.cents,
          version: { increment: 1 },
        },
      });

      const periods = await tx.subscriptionPeriod.count({
        where: { subscriptionId: current.id },
      });
      await tx.subscriptionPeriod.updateMany({
        where: { subscriptionId: current.id, closedAt: null },
        data: { closedAt: now },
      });
      await this.writePeriod(
        tx,
        current.id,
        periods,
        now,
        periodEnd,
        quoteSubscription({ plan: toPlanDomain(target), seats: current.seats }),
      );

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'billing.change_interval',
          entityType: 'Subscription',
          entityId: current.id,
          correlationId: context.correlationId,
          changedFields: [
            'planId',
            'interval',
            'currentPeriodEnd',
            'carriedCreditCents',
          ],
        },
        tx,
      );
    });

    return scope.organizationId
      ? this.organizationBilling(userId, scope.organizationId)
      : ((await this.familyBilling(userId)) ?? Promise.reject(new NotFoundError()));
  }

  /**
   * Cancel at the end of the period already paid for. Not a refund, and not an
   * immediate switch-off: a family mid-way through a booked month keeps live
   * tracking for the rides they have already arranged.
   */
  async cancel(
    userId: string,
    scope: { organizationId?: string },
    context: { correlationId?: string | null },
  ): Promise<BillingAccountDto> {
    if (scope.organizationId) {
      await this.organizations.requireMembership(userId, scope.organizationId, [
        'owner',
        'admin',
      ]);
    }
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const account = scope.organizationId
        ? await tx.billingAccount.findUnique({
            where: { organizationId: scope.organizationId },
          })
        : await tx.billingAccount.findUnique({ where: { ownerUserId: userId } });
      if (!account) throw new NotFoundError();

      const current = await this.liveSubscription(account.id, tx);
      if (!current) throw new NotFoundError();

      assertSubscriptionTransition(current.status, 'pendingCancellation');

      await tx.subscription.update({
        where: { id: current.id },
        data: {
          status: 'pendingCancellation',
          cancelRequestedAt: now,
          version: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'billing.cancel',
          entityType: 'Subscription',
          entityId: current.id,
          correlationId: context.correlationId,
          changedFields: ['status', 'cancelRequestedAt'],
        },
        tx,
      );
    });

    return scope.organizationId
      ? this.organizationBilling(userId, scope.organizationId)
      : ((await this.familyBilling(userId)) ?? Promise.reject(new NotFoundError()));
  }

  // ─── driver seats ─────────────────────────────────────────────────────────

  async organizationSeats(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationSeatsDto> {
    await this.organizations.requireMembership(userId, organizationId, [
      'owner',
      'admin',
      'dispatcher',
    ]);

    const account = await this.prisma.billingAccount.findUnique({
      where: { organizationId },
    });
    const subscription = account ? await this.liveSubscription(account.id) : null;

    const [activeDrivers, ledger] = await Promise.all([
      this.organizations.activeDriverCount(organizationId),
      subscription
        ? this.prisma.seatLedgerEntry.findMany({
            where: { subscriptionId: subscription.id },
            include: { driver: true },
            orderBy: { at: 'desc' },
            take: 100,
          })
        : Promise.resolve([]),
    ]);

    return {
      organizationId,
      activeDrivers,
      billedSeats: subscription?.seats ?? 0,
      renewalQuote: subscription
        ? toQuoteDto(
            quoteSubscription({
              plan: toPlanDomain(subscription.plan),
              seats: subscription.seats,
            }),
          )
        : null,
      ledger: ledger.map(toSeatLedgerDto),
    };
  }

  /** What N drivers would cost, for an operator sizing a plan before committing. */
  async quoteSeats(
    payerPlanCode: string,
    interval: BillingInterval,
    seats: number,
  ): Promise<SubscriptionQuoteDto> {
    const plan = await this.requirePlan(
      'dispatchOrganization',
      payerPlanCode,
      interval,
    );
    return toQuoteDto(quoteSubscription({ plan: toPlanDomain(plan), seats }));
  }

  /**
   * Records a driver joining or leaving a billable seat.
   *
   * Called from the driver lifecycle rather than by a nightly recount, because
   * a recount cannot say *when* a seat changed, and "when" is the whole of the
   * proration. Adding a driver is charged immediately for the remainder of the
   * period; releasing one takes effect at renewal and is not refunded — the
   * seat stays usable until the period that paid for it ends.
   *
   * A no-op when the operator has no subscription: an unsubscribed operator's
   * platform margin comes from the per-ride basis points instead, and billing
   * them for seats as well would be the double charge this whole model
   * refuses.
   */
  async recordSeatChange(input: {
    db: Db;
    organizationId: string;
    driverId: string;
    change: 'granted' | 'released';
    actorUserId?: string | null;
    now?: Date;
  }): Promise<void> {
    const { db, organizationId, driverId, change, actorUserId } = input;
    const now = input.now ?? new Date();

    const account = await db.billingAccount.findUnique({ where: { organizationId } });
    if (!account) return;

    const subscription = await this.liveSubscription(account.id, db);
    if (!subscription) return;

    const seatsAfter = await this.organizations.activeDriverCount(organizationId, db);

    const quote = quoteSeatChange({
      plan: toPlanDomain(subscription.plan),
      // The high-water mark, not the head count. See `quoteSeatChange`.
      seatsPaidFor: subscription.seatsPaidFor,
      seatsAfter,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      effectiveAt: now,
    });

    await db.seatLedgerEntry.create({
      data: {
        subscriptionId: subscription.id,
        driverId,
        change,
        at: now,
        actorUserId: actorUserId ?? null,
        seatsAfter,
        prorationCents: quote.dueNow.cents,
      },
    });

    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        seats: quote.seatsFromNextRenewal,
        seatsPaidFor: quote.seatsPaidForAfter,
        version: { increment: 1 },
      },
    });
  }
}

/** Narrow helper so the DTO mapper does not import the domain twice. */
function activeOrEmpty(
  state: ReturnType<typeof toEntitlementState>,
  now: Date,
): readonly Entitlement[] {
  return state.entitlements.filter((entitlement) =>
    hasEntitlement(state, entitlement, now),
  );
}
