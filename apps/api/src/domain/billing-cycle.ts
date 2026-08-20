import { DateTime } from 'luxon';

import { graceEndsAt, type SubscriptionEntitlementState } from './billing';

/**
 * The clock a subscription runs on. Mirrors lib/domain/billing_cycle.dart.
 *
 * Everything in `billing.ts` answers "what is switched on right now". Nothing
 * there ever *moves* — and until this file existed, nothing else did either:
 * a trial that had run out still reported `trialing`, and `isEntitling`
 * answers `true` for `trialing` unconditionally, so a fourteen-day trial
 * entitled live tracking forever. The same hole sat under `active`, whose
 * `currentPeriodEnd` was written once and never consulted again.
 *
 * That is the failure mode worth naming precisely, because it is silent in
 * both directions: nobody complains about a subscription that never stops
 * working, and nobody notices the revenue that was never billed. It is found
 * by an accountant, months later, and by then every affected period is closed.
 *
 * So the decision is a pure function of the row and the instant, and the sweep
 * that applies it owns no rules of its own.
 */

export type CycleActionKind =
  /** Nothing is due. */
  | 'none'
  /** The trial ran out: close it, open the first paid period, charge it. */
  | 'convertTrial'
  /** The paid period ran out: open the next one and charge it. */
  | 'renew'
  /** Cancelled, and the period they paid for has now ended. */
  | 'finishCancellation'
  /** A payment failed and the grace window has closed. */
  | 'expire';

export interface CycleAction {
  kind: CycleActionKind;
  /**
   * The instant the new period begins, for the two actions that open one.
   *
   * Deliberately **not** `now`. A sweep that runs forty minutes late must not
   * push the renewal date forty minutes later — do that every month and a
   * subscriber bought on the 1st is billed on the 9th by the end of the year,
   * with each drift permanently baked into the next anchor. Anchoring to the
   * boundary that was already scheduled keeps the renewal date fixed, and
   * makes a late sweep late rather than wrong.
   */
  effectiveAt: Date | null;
}

const NOTHING: CycleAction = { kind: 'none', effectiveAt: null };

/**
 * The clock state of a subscription: `SubscriptionEntitlementState` plus the
 * two boundaries that only the cycle cares about.
 */
export interface SubscriptionCycleState extends SubscriptionEntitlementState {
  currentPeriodStart: Date;
  /** Null unless the subscription is, or was, on trial. */
  trialEndsAt: Date | null;
}

/**
 * What is due on this subscription at this instant, and nothing more.
 *
 * One action per call even when a subscription is several periods behind. The
 * sweep re-reads and re-decides, so an instance that was down for a fortnight
 * catches up one period per pass rather than opening a fortnight of periods
 * inside a single transaction — and each caught-up period is charged, dunned
 * and invoiced on its own, which is the only form in which it can be explained
 * to the person who pays it.
 */
export function decideCycleAction(
  subscription: SubscriptionCycleState,
  now: Date,
): CycleAction {
  switch (subscription.status) {
    case 'trialing': {
      // A trial with no end date is a configuration mistake, not a licence to
      // run forever. Treated as "not due yet" rather than converted on the
      // spot: charging a card because a column was null is the worse error.
      const endsAt = subscription.trialEndsAt;
      if (endsAt == null || now.getTime() < endsAt.getTime()) return NOTHING;
      return { kind: 'convertTrial', effectiveAt: endsAt };
    }

    case 'active': {
      if (now.getTime() < subscription.currentPeriodEnd.getTime()) return NOTHING;
      return { kind: 'renew', effectiveAt: subscription.currentPeriodEnd };
    }

    case 'pendingCancellation': {
      // Runs to the end of the period that was paid for, because it was paid
      // for. Cancelling is not a refund.
      if (now.getTime() < subscription.currentPeriodEnd.getTime()) return NOTHING;
      return { kind: 'finishCancellation', effectiveAt: subscription.currentPeriodEnd };
    }

    case 'pastDue': {
      // Still entitling until the grace window closes — see `activeEntitlements`
      // for why that window is not zero. Retries inside it are the dunning
      // schedule's business, not the cycle's.
      const graceEnd = graceEndsAt(subscription);
      if (now.getTime() < graceEnd.getTime()) return NOTHING;
      return { kind: 'expire', effectiveAt: graceEnd };
    }

    case 'canceled':
    case 'expired':
      return NOTHING;
  }
}

/**
 * How many whole periods a subscription is behind. Zero when it is current.
 *
 * Only used for reporting — an operator wants to know that a sweep has been
 * down, and "three periods behind" is the sentence that says so. The catch-up
 * itself is one period per pass, above.
 */
export function periodsBehind(
  subscription: SubscriptionCycleState,
  now: Date,
  interval: 'monthly' | 'annual',
): number {
  if (now.getTime() < subscription.currentPeriodEnd.getTime()) return 0;

  const unit = interval === 'annual' ? 'years' : 'months';
  const elapsed = DateTime.fromJSDate(now, { zone: 'utc' })
    .diff(DateTime.fromJSDate(subscription.currentPeriodEnd, { zone: 'utc' }), unit)
    .as(unit);

  return Math.floor(elapsed) + 1;
}
