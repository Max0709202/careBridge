/**
 * What a household pays, as the app renders it. Mirrors lib/domain/billing.dart,
 * subscription_pricing.dart and invoicing.dart.
 *
 * This copy decides nothing. Entitlements, amounts due and invoice status all
 * come from the server; what lives here is labels, the plan-card price, and how
 * a failed payment is *described* to somebody.
 */
import { multiplyCents } from '../core/money';

export type BillingPayer = 'family' | 'dispatchOrganization';

export type BillingInterval = 'monthly' | 'annual';
export const intervalLabel: Record<BillingInterval, string> = {
  monthly: 'Monthly',
  annual: 'Yearly',
};
/** What follows the price on a plan card: "$29 a month". */
export const intervalCadence: Record<BillingInterval, string> = {
  monthly: 'a month',
  annual: 'a year',
};

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'pastDue',
  'pendingCancellation',
  'canceled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const ENTITLEMENTS = [
  'requestTransport',
  'liveTracking',
  'unlimitedCareCircle',
  'appointmentReminders',
  'prioritySupport',
  'dispatchConsole',
  'driverApp',
  'bulkAssignment',
  'operationsAnalytics',
  'partnerApi',
] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];
export const entitlementLabel: Record<Entitlement, string> = {
  requestTransport: 'Book transportation',
  liveTracking: 'Follow trips live',
  unlimitedCareCircle: 'Unlimited care circle',
  appointmentReminders: 'Appointment reminders',
  prioritySupport: 'Priority support',
  dispatchConsole: 'Dispatch console',
  driverApp: 'Driver app',
  bulkAssignment: 'Bulk assignment',
  operationsAnalytics: 'Operations analytics',
  partnerApi: 'Partner API',
};

export interface Subscription {
  id: string;
  payer: BillingPayer;
  status: SubscriptionStatus;
  interval: BillingInterval;
  planCode: string;
  planName: string;
  planVersion: string;
  seats: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
  cancelRequestedAt: Date | null;
  /** Resolved server-side from status, period and grace. Never re-derived here. */
  entitlements: Entitlement[];
  renewalTotalCents: number;
  carriedCreditCents: number;
}

/**
 * Whether the payer should be told something needs attention. Not the same as
 * "switched off": a failed payment still entitles for the grace window.
 */
export const subscriptionNeedsAttention = (s: Subscription) =>
  s.status === 'pastDue' || s.status === 'pendingCancellation';

export function subscriptionSummary(s: Subscription): string {
  switch (s.status) {
    case 'trialing':
      return `Free trial of ${s.planName}`;
    case 'active':
      return s.planName;
    case 'pastDue':
      return `${s.planName} — payment failed`;
    case 'pendingCancellation':
      return `${s.planName} — ends soon`;
    case 'canceled':
    case 'expired':
      return 'No plan';
  }
}

export interface SeatTier {
  upToSeats: number | null;
  unitPriceCents: number;
}

export interface SubscriptionPlan {
  code: string;
  version: string;
  payer: BillingPayer;
  interval: BillingInterval;
  name: string;
  description: string;
  basePriceCents: number;
  includedSeats: number;
  seatTiers: SeatTier[];
  entitlements: Entitlement[];
  trialDays: number;
  graceDays: number;
}

/**
 * The price of one period. Graduated, not volume: each driver is priced in the
 * band they fall in. A family plan has no seats, so this is its base price.
 */
export function periodPriceCents(plan: SubscriptionPlan, seats = 0): number {
  let total = plan.basePriceCents;
  let floor = plan.includedSeats;
  for (const tier of plan.seatTiers) {
    const ceiling = tier.upToSeats === null ? seats : Math.min(tier.upToSeats, seats);
    const quantity = ceiling - floor;
    if (quantity > 0) total += multiplyCents(tier.unitPriceCents, quantity);
    if (tier.upToSeats === null) break;
    if (tier.upToSeats > floor) floor = tier.upToSeats;
    if (seats <= tier.upToSeats) break;
  }
  return total;
}

// ─── invoices ────────────────────────────────────────────────────────────────

export type InvoiceReason = 'subscriptionPeriod' | 'seatProration' | 'intervalSwitch';
export const invoiceReasonLabel: Record<InvoiceReason, string> = {
  subscriptionPeriod: 'Subscription',
  seatProration: 'Driver seats added',
  intervalSwitch: 'Billing period changed',
};

export type InvoiceStatus = 'open' | 'paid' | 'uncollectible' | 'void';
/**
 * `uncollectible` is deliberately not "failed": by then the retries are over,
 * and "failed" invites another attempt at a card that will not work.
 */
export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  open: 'Due',
  paid: 'Paid',
  uncollectible: 'Unpaid',
  void: 'Cancelled',
};

export interface InvoiceLine {
  label: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface Invoice {
  id: string;
  /** Human-quotable, so it is shown rather than hidden behind an id. */
  number: string;
  reason: InvoiceReason;
  status: InvoiceStatus;
  subtotalCents: number;
  creditAppliedCents: number;
  totalCents: number;
  amountPaidCents: number;
  lines: InvoiceLine[];
  issuedAt: Date;
  paidAt: Date | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastFailureCode: string | null;
}

export const invoiceIsOutstanding = (i: Invoice) => i.status === 'open';
/**
 * Only an open invoice: retrying a paid one takes money twice, and retrying an
 * uncollectible one presents a card the issuer has already refused.
 */
export const invoiceCanBePaidNow = (i: Invoice) => i.status === 'open';

/**
 * How a failed payment is explained: say what has *not* stopped before saying
 * what failed. The grace window exists so nothing stops immediately.
 */
export const DunningCopy = {
  headline(invoice: Invoice): string {
    return invoice.status === 'uncollectible'
      ? 'We could not take your payment'
      : 'Your payment did not go through';
  },
  detail(invoice: Invoice, graceEndsAt?: Date): string {
    if (invoice.status === 'uncollectible') {
      return 'We have stopped trying this card. Update it to keep your plan.';
    }
    if (graceEndsAt) {
      const day = `${graceEndsAt.getFullYear()}-${two(graceEndsAt.getMonth() + 1)}-${two(graceEndsAt.getDate())}`;
      return `Nothing has been switched off. Your plan keeps working until ${day} while you sort this out.`;
    }
    return 'Nothing has been switched off. Update your card when you can.';
  },
};

const two = (n: number) => String(n).padStart(2, '0');

// ─── the card on file ────────────────────────────────────────────────────────

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

const brandLabels: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
};

/** "Visa ···· 4242". */
export const paymentMethodLabel = (card: PaymentMethod) =>
  `${brandLabels[card.brand.toLowerCase()] ?? 'Card'} ···· ${card.last4}`;

/** A card marked 12/2026 works until the last day of December. */
const endOfExpiryMonth = (card: PaymentMethod) =>
  Date.UTC(card.expYear, card.expMonth, 1);

export const cardHasExpired = (card: PaymentMethod, now: Date) =>
  now.getTime() >= endOfExpiryMonth(card);

/** Warned before it fails, not after. */
export function cardExpiresSoon(card: PaymentMethod, now: Date, days = 45): boolean {
  if (cardHasExpired(card, now)) return false;
  const remainingDays = Math.floor(
    (endOfExpiryMonth(card) - now.getTime()) / 86_400_000,
  );
  return remainingDays <= days;
}
