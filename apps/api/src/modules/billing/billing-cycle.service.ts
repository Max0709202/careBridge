import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QUEUE, QUEUES, type QueuePort } from '../../infrastructure/queue/queue.port';
import { AuditService } from '../audit/audit.service';
import { assertSubscriptionTransition, periodEndFor } from '../../domain/billing';
import { decideCycleAction, type CycleAction } from '../../domain/billing-cycle';
import { quoteSubscription } from '../../domain/subscription-pricing';
import { Money } from '../../domain/money';
import { InvoicesService } from './invoices.service';
import {
  SUBSCRIPTION_INCLUDE,
  toEntitlementState,
  toPlanDomain,
  toStoredLines,
  type SubscriptionRow,
} from './billing.mapper';

export interface CycleSweepResult {
  converted: number;
  renewed: number;
  canceled: number;
  expired: number;
  collected: number;
}

/**
 * The clock every subscription runs on.
 *
 * Before this existed nothing in the system ever moved a subscription forward.
 * A period end was written once and never read again; a trial's end date was
 * stored and never acted on. Since `isEntitling` answers `true` for `trialing`
 * and `active` without consulting either date, the effect was that **every
 * trial entitled the product permanently** and no period was ever billed —
 * silent in both directions, and discovered by an accountant rather than by a
 * user.
 *
 * A sweep rather than a timer per subscription, for the reason the notification
 * outbox is a sweep: a job scheduled at renewal time is a job that can be lost
 * by a restart, dropped by a queue migration, or never created because one of
 * several call sites forgot. A sweep cannot be forgotten, and re-running it is
 * a no-op, so the failure mode is lateness rather than a subscription that
 * quietly never renews.
 *
 * The rules are all in `domain/billing-cycle.ts`. This service owns only the
 * order of writes.
 */
@Injectable()
export class BillingCycleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingCycleService.name);

  /**
   * Hourly.
   *
   * Not daily: a renewal is the moment a card is charged, and a family whose
   * card fails at 00:05 should be inside their dunning schedule by 01:05
   * rather than a day later — the grace window is measured in days and losing
   * one of them to sweep latency is a fifth of it. Not by the minute either:
   * a period boundary is not urgent to the hour, and each pass reads every
   * live subscription.
   */
  private static readonly INTERVAL_MS = 60 * 60 * 1000;

  /**
   * Subscriptions examined per pass. A ceiling rather than a target: the
   * query is indexed on `(status, currentPeriodEnd)` and anything past this is
   * picked up by the next pass an hour later, which is the correct behaviour
   * for a backlog and a bounded one for memory.
   */
  private static readonly BATCH = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
    @Inject(QUEUE) private readonly queue: QueuePort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue.registerWorker<{ scheduledAt: string }>(QUEUES.billing, async () => {
      await this.run();
      // Re-arms itself rather than relying on a repeatable-job feature only
      // one of the two queue adapters has. One mechanism, both drivers — the
      // same shape as the retention sweep.
      await this.schedule();
    });

    await this.schedule();
  }

  private async schedule(): Promise<void> {
    await this.queue.enqueue(
      QUEUES.billing,
      'sweep',
      { scheduledAt: new Date().toISOString() },
      {
        // A fixed id would be refused as a duplicate while the previous
        // sweep's job still exists, so the hour is part of it.
        jobId: `billing:${Math.floor(Date.now() / BillingCycleService.INTERVAL_MS) + 1}`,
        delayMs: BillingCycleService.INTERVAL_MS,
      },
    );
  }

  /**
   * One pass.
   *
   * Each subscription is handled independently and failure-isolated. One
   * account with a corrupt plan row must not stop every other renewal in the
   * system — which is exactly what a single transaction around the batch would
   * do, and the symptom would be "nobody was billed this month".
   */
  async run(now = new Date()): Promise<CycleSweepResult> {
    const result: CycleSweepResult = {
      converted: 0,
      renewed: 0,
      canceled: 0,
      expired: 0,
      collected: 0,
    };

    const due = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['trialing', 'active', 'pastDue', 'pendingCancellation'] },
        // Cheap pre-filter. The authority is `decideCycleAction`; this only
        // keeps the batch from being every live subscription every hour.
        OR: [
          { currentPeriodEnd: { lte: now } },
          { trialEndsAt: { not: null, lte: now } },
          { status: 'pastDue' },
        ],
      },
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { currentPeriodEnd: 'asc' },
      take: BillingCycleService.BATCH,
    });

    for (const subscription of due) {
      try {
        await this.advance(subscription, now, result);
      } catch (error) {
        this.logger.error(
          `Billing cycle failed for subscription ${subscription.id}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    result.collected = await this.collectDue(now);

    const moved = result.converted + result.renewed + result.canceled + result.expired;
    if (moved > 0 || result.collected > 0) {
      this.logger.log({ ...result }, 'Billing cycle swept');
    }

    return result;
  }

  private async advance(
    subscription: SubscriptionRow,
    now: Date,
    result: CycleSweepResult,
  ): Promise<void> {
    const action = decideCycleAction(
      {
        ...toEntitlementState(subscription),
        currentPeriodStart: subscription.currentPeriodStart,
        trialEndsAt: subscription.trialEndsAt,
      },
      now,
    );

    switch (action.kind) {
      case 'none':
        return;

      case 'convertTrial':
      case 'renew': {
        const invoiceId = await this.openNextPeriod(subscription, action, now);
        if (action.kind === 'convertTrial') result.converted += 1;
        else result.renewed += 1;
        // Collected outside the transaction that opened the period — see
        // `BillingService.collectAll` for why that separation is not optional.
        if (invoiceId) await this.invoices.collect(invoiceId, now);
        return;
      }

      case 'finishCancellation':
        await this.close(subscription, 'canceled', now);
        result.canceled += 1;
        return;

      case 'expire':
        await this.close(subscription, 'expired', now);
        result.expired += 1;
        return;
    }
  }

  /**
   * Closes the period that ended and opens the next, in one transaction.
   *
   * The new period is anchored to `action.effectiveAt` — the boundary that was
   * already scheduled — rather than to `now`. A sweep running forty minutes
   * late must not move the renewal date, or a subscriber bought on the 1st is
   * billed on the 9th by December.
   */
  private async openNextPeriod(
    subscription: SubscriptionRow,
    action: CycleAction,
    now: Date,
  ): Promise<string | null> {
    const startsAt = action.effectiveAt ?? now;
    const endsAt = periodEndFor(startsAt, subscription.interval);

    const quote = quoteSubscription({
      plan: toPlanDomain(subscription.plan),
      seats: subscription.seats,
    });

    // `active → active` is not a transition, and the state machine correctly
    // does not list it: renewing an already-active subscription changes the
    // period, not the status. Only a trial conversion actually moves it, so
    // that is the only case worth asserting — and it is asserted *before* the
    // write rather than after, so an illegal move cannot be committed and then
    // complained about.
    if (subscription.status !== 'active') {
      assertSubscriptionTransition(subscription.status, 'active');
    }

    return this.prisma.$transaction(async (tx) => {
      // Optimistic lock on the row, matching rides and appointments. Two
      // sweeps reaching the same subscription together: one wins, the other's
      // update matches no row and it opens no second period.
      const claimed = await tx.subscription.updateMany({
        where: { id: subscription.id, version: subscription.version },
        data: {
          status: 'active',
          currentPeriodStart: startsAt,
          currentPeriodEnd: endsAt,
          // The reduction an operator asked for takes effect now, which is
          // what "at renewal" meant, so the high-water mark restarts with it.
          seatsPaidFor: subscription.seats,
          trialEndsAt: null,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      await tx.subscriptionPeriod.updateMany({
        where: { subscriptionId: subscription.id, closedAt: null },
        data: { closedAt: startsAt },
      });

      const sequence = await tx.subscriptionPeriod.count({
        where: { subscriptionId: subscription.id },
      });

      const base = quote.lines[0]?.amount ?? Money.zero();
      const period = await tx.subscriptionPeriod.create({
        data: {
          subscriptionId: subscription.id,
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

      const invoice = await this.invoices.issue({
        db: tx,
        billingAccountId: subscription.billingAccountId,
        subscriptionId: subscription.id,
        periodId: period.id,
        reason: 'subscriptionPeriod',
        quote,
        credit: {
          cents: subscription.carriedCreditCents,
          fromCarriedBalance: true,
        },
        now,
      });

      await this.audit.record(
        {
          actorUserId: null,
          action:
            action.kind === 'convertTrial'
              ? 'billing.trial_converted'
              : 'billing.renewed',
          entityType: 'Subscription',
          entityId: subscription.id,
          changedFields: ['status', 'currentPeriodStart', 'currentPeriodEnd'],
        },
        tx,
      );

      return invoice.id;
    });
  }

  /** Ends a subscription, without touching what it was charged. */
  private async close(
    subscription: SubscriptionRow,
    to: 'canceled' | 'expired',
    now: Date,
  ): Promise<void> {
    assertSubscriptionTransition(subscription.status, to);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.subscription.updateMany({
        where: { id: subscription.id, version: subscription.version },
        data: { status: to, canceledAt: now, version: { increment: 1 } },
      });
      if (claimed.count === 0) return;

      await tx.subscriptionPeriod.updateMany({
        where: { subscriptionId: subscription.id, closedAt: null },
        data: { closedAt: now },
      });

      await this.audit.record(
        {
          actorUserId: null,
          action:
            to === 'canceled' ? 'billing.cancellation_completed' : 'billing.expired',
          entityType: 'Subscription',
          entityId: subscription.id,
          changedFields: ['status', 'canceledAt'],
        },
        tx,
      );
    });
  }

  /** Every invoice whose retry has come due, plus any nobody has attempted. */
  private async collectDue(now: Date): Promise<number> {
    const due = await this.invoices.dueForRetry(now);
    let collected = 0;

    for (const invoice of due) {
      try {
        await this.invoices.collect(invoice.id, now);
        collected += 1;
      } catch (error) {
        this.logger.error(
          `Collection failed for invoice ${invoice.number}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    return collected;
  }
}
