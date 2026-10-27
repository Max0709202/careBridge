/**
 * What an operator pays, as the console renders it. A port of
 * apps/ops_console/lib/domain/billing.dart.
 *
 * The **second** payer (ADR-0011): a transport operator paying for the
 * console, the driver app and assignment, priced by drivers on the road. Like
 * every domain file here, it decides nothing — the server resolves
 * entitlements and sends the answer.
 */

export const BILLING_INTERVALS = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function parseInterval(value: unknown): BillingInterval | null {
  return (BILLING_INTERVALS as readonly unknown[]).includes(value)
    ? (value as BillingInterval)
    : null;
}

export const intervalLabel: Record<BillingInterval, string> = {
  monthly: 'Monthly',
  annual: 'Yearly',
};

/** What follows the price on a plan card: "$249 a month". */
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

export function parseSubscriptionStatus(value: unknown): SubscriptionStatus | null {
  return (SUBSCRIPTION_STATUSES as readonly unknown[]).includes(value)
    ? (value as SubscriptionStatus)
    : null;
}

export const subscriptionStatusLabel: Record<SubscriptionStatus, string> = {
  trialing: 'Free trial',
  active: 'Active',
  pastDue: 'Payment failed',
  pendingCancellation: 'Ends at the period',
  canceled: 'Cancelled',
  expired: 'Expired',
};

/** Whether somebody has to do something about it today. A pending cancellation was a decision. */
export const subscriptionNeedsAttention = (s: SubscriptionStatus) =>
  s === 'pastDue' || s === 'expired' || s === 'canceled';

/** One band of the graduated per-driver ladder. `upToSeats` null is the unbounded final band. */
export interface SeatTier {
  upToSeats: number | null;
  unitPriceCents: number;
}

export interface OperatorPlan {
  code: string;
  version: string;
  interval: BillingInterval;
  name: string;
  description: string;
  basePriceCents: number;
  /** Drivers the base price already covers. The ladder starts above it. */
  includedSeats: number;
  seatTiers: SeatTier[];
  /** Raw keys, rendered as text: the console gates nothing on them. */
  entitlements: string[];
  trialDays: number;
  /** How long a failed payment keeps entitling — asked about at the moment of subscribing. */
  graceDays: number;
}

export interface BillingLine {
  label: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

/** What the next renewal will cost, itemised: "why is it $412?" is answered by the lines. */
export interface BillingQuote {
  planCode: string;
  interval: BillingInterval;
  seats: number;
  billableSeats: number;
  lines: BillingLine[];
  totalCents: number;
}

export const INVOICE_STATUSES = ['open', 'paid', 'uncollectible', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function parseInvoiceStatus(value: unknown): InvoiceStatus | null {
  return (INVOICE_STATUSES as readonly unknown[]).includes(value)
    ? (value as InvoiceStatus)
    : null;
}

/**
 * `uncollectible` is deliberately not "failed": the retries are over, and
 * "failed" invites another attempt at a card that will not work.
 */
export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  open: 'Due',
  paid: 'Paid',
  uncollectible: 'Unpaid',
  void: 'Cancelled',
};

export const INVOICE_REASONS = [
  'subscriptionPeriod',
  'seatProration',
  'intervalSwitch',
] as const;
export type InvoiceReason = (typeof INVOICE_REASONS)[number];

export function parseInvoiceReason(value: unknown): InvoiceReason | null {
  return (INVOICE_REASONS as readonly unknown[]).includes(value)
    ? (value as InvoiceReason)
    : null;
}

export const invoiceReasonLabel: Record<InvoiceReason, string> = {
  subscriptionPeriod: 'Subscription',
  seatProration: 'Drivers added mid-period',
  intervalSwitch: 'Change of billing period',
};

export interface Invoice {
  id: string;
  number: string;
  reason: InvoiceReason;
  status: InvoiceStatus;
  subtotalCents: number;
  /** Shown as its own line rather than netted silently. */
  creditAppliedCents: number;
  totalCents: number;
  amountPaidCents: number;
  lines: BillingLine[];
  issuedAt: Date;
  /** Zero on an invoice nothing has attempted yet — different from one that failed once. */
  attemptCount: number;
  paidAt: Date | null;
  nextAttemptAt: Date | null;
  lastFailureCode: string | null;
}

/** Whether dunning has started on this one. */
export const hasFailed = (i: Invoice) => i.attemptCount > 0 && i.status === 'open';

/**
 * Offered on anything still owed, including `uncollectible`: the retries
 * stopped, but a person with a new card should not have to telephone anybody.
 */
export const isPayable = (i: Invoice) =>
  i.status === 'open' || i.status === 'uncollectible';

/** The card on file. Four digits and a brand — no card number exists anywhere to decode. */
export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export const paymentMethodLabel = (p: PaymentMethod) => `${p.brand} •••• ${p.last4}`;

/** Whether the card has lapsed: spent the moment its month is over. */
export function hasExpired(p: PaymentMethod, now: Date): boolean {
  const endOfMonth = new Date(p.expYear, p.expMonth, 1); // month is 0-based, so this is the 1st of the next
  return now.getTime() >= endOfMonth.getTime();
}

export interface OperatorSubscription {
  id: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  planCode: string;
  planName: string;
  /** Drivers billed from the next renewal. */
  seats: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  entitlements: string[];
  renewalQuote: BillingQuote;
  /** Unspent money from a period cut short, applied before the card is. */
  carriedCreditCents: number;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
  /** The subscription keeps entitling until `currentPeriodEnd` — the period is paid for. */
  cancelRequestedAt: Date | null;
}

export const isTrialing = (s: OperatorSubscription) => s.status === 'trialing';
export const isCancelling = (s: OperatorSubscription) => s.cancelRequestedAt !== null;

export interface BillingAccount {
  id: string;
  billingEmail: string;
  /** The sum of everything still owed. */
  amountDueCents: number;
  organizationId: string | null;
  subscription: OperatorSubscription | null;
  paymentMethod: PaymentMethod | null;
}

/**
 * A subscription that will bill a card that is not there — the single most
 * common way an account lapses without anybody deciding to let it.
 */
export const willBillWithoutACard = (a: BillingAccount) =>
  a.subscription !== null && a.paymentMethod === null;
