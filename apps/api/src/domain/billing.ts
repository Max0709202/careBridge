import { DateTime } from 'luxon';

import { InvalidTransitionError, ValidationError } from '../common/errors';

/**
 * Who pays, on what cadence, and what that buys. Mirrors lib/domain/billing.dart.
 *
 * CareBridge has **two** paying parties, and conflating them is the mistake
 * this file exists to prevent:
 *
 *   - a **family** pays for the coordination product around one household's
 *     patients, and separately pays the fare for each ride;
 *   - a **dispatch organisation** pays for the operational product — the
 *     console, the driver app, assignment — priced by how many drivers it has
 *     on the road.
 *
 * They are different buyers with different renewal conversations, but the
 * *mechanism* is identical: a plan record, a period, a status, and a set of
 * entitlements resolved server-side. So there is one subscription model with a
 * `payer` discriminator rather than two parallel ones. Two implementations of
 * "is this subscription currently entitling anything" would eventually
 * disagree, and the disagreement is either a family locked out of a live trip
 * or an operator using a console it stopped paying for.
 */

// ─── who pays ────────────────────────────────────────────────────────────────

/**
 * The two sides of the marketplace that can hold a subscription. Deliberately
 * not called "customer type": a family is a household of users, an
 * organisation is a company, and neither is a row in the other's table.
 */
export type BillingPayer = 'family' | 'dispatchOrganization';

export const BILLING_PAYERS: readonly BillingPayer[] = [
  'family',
  'dispatchOrganization',
];

/**
 * Monthly or annual, and nothing in between.
 *
 * Annual is not "monthly × 12 with a discount applied in code" — it is a
 * separate plan row with its own price, for the same reason a fare is a row:
 * the commercial decision to discount by 17% this quarter and 20% next must
 * not be a deploy, and a multiplier hides where the rounding happened.
 */
export type BillingInterval = 'monthly' | 'annual';

export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'annual'];

// ─── lifecycle ───────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  /** A payment failed. Still entitling, for the grace window — see below. */
  | 'pastDue'
  /** Cancelled by the payer, still entitling until the period they paid for ends. */
  | 'pendingCancellation'
  | 'canceled'
  /** Ran out: a trial nobody converted, or a grace window nobody rescued. */
  | 'expired';

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'pastDue',
  'pendingCancellation',
  'canceled',
  'expired',
];

/**
 * There is no edge back out of `canceled` or `expired`. Re-subscribing creates
 * a **new** subscription rather than reviving the old one, so the record of
 * what somebody was charged under which plan stays immutable — the same reason
 * a ride keeps its pricing rule version.
 */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trialing: ['active', 'pendingCancellation', 'canceled', 'expired'],
  active: ['pastDue', 'pendingCancellation', 'canceled'],
  pastDue: ['active', 'canceled', 'expired'],
  pendingCancellation: ['active', 'canceled'],
  canceled: [],
  expired: [],
};

export function canTransitionSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertSubscriptionTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): void {
  if (!canTransitionSubscription(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminalSubscriptionStatus(status: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

// ─── what a subscription buys ────────────────────────────────────────────────

/**
 * Entitlements are strings on a plan row, not an enum the code branches on in
 * twenty places — a new plan tier must be a database insert. The union below
 * is the *catalogue*, so a typo in a seed is a type error rather than a
 * silently unreachable feature.
 */
export type Entitlement =
  // family
  | 'requestTransport'
  | 'liveTracking'
  | 'unlimitedCareCircle'
  | 'appointmentReminders'
  | 'prioritySupport'
  // dispatch organisation
  | 'dispatchConsole'
  | 'driverApp'
  | 'bulkAssignment'
  | 'operationsAnalytics'
  | 'partnerApi';

export const FAMILY_ENTITLEMENTS: readonly Entitlement[] = [
  'requestTransport',
  'liveTracking',
  'unlimitedCareCircle',
  'appointmentReminders',
  'prioritySupport',
];

export const DISPATCH_ENTITLEMENTS: readonly Entitlement[] = [
  'dispatchConsole',
  'driverApp',
  'bulkAssignment',
  'operationsAnalytics',
  'partnerApi',
];

/**
 * A family plan cannot grant `dispatchConsole`, and an operator plan cannot
 * grant `liveTracking` over somebody else's relative. Checked when a plan is
 * written, so a mis-seeded plan fails at the seam rather than at the surface
 * it wrongly opens.
 */
export function entitlementsForPayer(payer: BillingPayer): readonly Entitlement[] {
  return payer === 'family' ? FAMILY_ENTITLEMENTS : DISPATCH_ENTITLEMENTS;
}

export function assertEntitlementsMatchPayer(
  payer: BillingPayer,
  entitlements: readonly Entitlement[],
): void {
  const allowed = entitlementsForPayer(payer);
  for (const entitlement of entitlements) {
    if (!allowed.includes(entitlement)) {
      throw new ValidationError(
        `A ${payer} plan cannot grant "${entitlement}".`,
        'entitlements',
      );
    }
  }
}

// ─── entitlement resolution ──────────────────────────────────────────────────

/**
 * The subset of a subscription that decides what is currently switched on.
 * Deliberately not the database row: everything here is a rule, and taking the
 * row would drag Prisma into the one layer that is testable because it cannot
 * reach anything.
 */
export interface SubscriptionEntitlementState {
  status: SubscriptionStatus;
  entitlements: readonly Entitlement[];
  /** End of the period already paid for. */
  currentPeriodEnd: Date;
  /** When the first payment failed. Null unless `pastDue`. */
  pastDueSince: Date | null;
  /** How long a failed payment keeps entitling. From the plan. */
  graceDays: number;
}

/**
 * What is switched on **right now**.
 *
 * The `pastDue` branch is the one with a human cost behind it. A card expires
 * — which happens to everybody, and disproportionately to the adult children
 * managing an ageing parent's logistics between other obligations — and the
 * naive implementation cuts live tracking off mid-trip. The family's first
 * signal that a payment failed would be a blank map while their mother is in a
 * stranger's car. So a failed payment keeps entitling for the plan's grace
 * window; dunning happens by email, in the surface built for it.
 *
 * `pendingCancellation` keeps entitling until the end of the period that was
 * paid for, because it was. Cancelling is not a refund.
 */
export function activeEntitlements(
  subscription: SubscriptionEntitlementState,
  now: Date,
): readonly Entitlement[] {
  return isEntitling(subscription, now) ? subscription.entitlements : [];
}

export function isEntitling(
  subscription: SubscriptionEntitlementState,
  now: Date,
): boolean {
  switch (subscription.status) {
    case 'trialing':
    case 'active':
      return true;
    case 'pendingCancellation':
      return now.getTime() < subscription.currentPeriodEnd.getTime();
    case 'pastDue':
      return now.getTime() < graceEndsAt(subscription).getTime();
    case 'canceled':
    case 'expired':
      return false;
  }
}

/**
 * When the grace window closes. `pastDueSince` is null only if a caller built
 * the state wrongly; treating that as "grace already over" is the safe reading
 * — it under-entitles rather than granting an unbounded free ride.
 */
export function graceEndsAt(subscription: SubscriptionEntitlementState): Date {
  if (subscription.pastDueSince == null) return new Date(0);
  return addDays(subscription.pastDueSince, subscription.graceDays);
}

export function hasEntitlement(
  subscription: SubscriptionEntitlementState | null | undefined,
  entitlement: Entitlement,
  now: Date,
): boolean {
  if (subscription == null) return false;
  return activeEntitlements(subscription, now).includes(entitlement);
}

// ─── period arithmetic ───────────────────────────────────────────────────────

/**
 * The end of a billing period that began at `start`.
 *
 * Calendar months, not 30-day blocks: a subscriber who signs up on the 31st
 * renews on the 30th of a 30-day month and on the 28th of February, then back
 * on the 31st — which is what every other subscription they hold does, and
 * what their bank statement will show. Adding 2_592_000_000 milliseconds
 * instead drifts the renewal date backwards through the year.
 */
export function periodEndFor(start: Date, interval: BillingInterval): Date {
  const from = DateTime.fromJSDate(start, { zone: 'utc' });
  const to = interval === 'annual' ? from.plus({ years: 1 }) : from.plus({ months: 1 });
  return to.toJSDate();
}

/** End of a trial that began at `start`. Zero days means no trial at all. */
export function trialEndsAt(start: Date, trialDays: number): Date | null {
  if (trialDays <= 0) return null;
  return addDays(start, trialDays);
}

function addDays(from: Date, days: number): Date {
  return DateTime.fromJSDate(from, { zone: 'utc' }).plus({ days }).toJSDate();
}
