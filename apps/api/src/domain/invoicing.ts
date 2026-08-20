/**
 * The vocabulary of an invoice. Mirrors lib/domain/invoicing.dart.
 *
 * Here rather than in the DTO file for the same reason `SUBSCRIPTION_STATUSES`
 * is: these strings are named once, the OpenAPI enum is generated from the
 * constant, and the Dart client is generated from that — so a value added on
 * one side cannot be silently missing on the other.
 */

export type InvoiceReason =
  /** The recurring charge for one billed period. */
  | 'subscriptionPeriod'
  /** Drivers added mid-period, charged for the remainder of it. */
  | 'seatProration'
  /** Monthly ⇄ annual, where the new period's price outran the credit. */
  | 'intervalSwitch';

export const INVOICE_REASONS: readonly InvoiceReason[] = [
  'subscriptionPeriod',
  'seatProration',
  'intervalSwitch',
];

export type InvoiceStatus =
  /** Issued and owed. */
  | 'open'
  | 'paid'
  /** Dunning ran out, or the card will never work. Owed, no longer pursued. */
  | 'uncollectible'
  /** Withdrawn: never owed. */
  | 'void';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'open',
  'paid',
  'uncollectible',
  'void',
];

/**
 * `uncollectible` and `void` both mean "this will not be paid", and merging
 * them is the mistake this function exists to make hard.
 *
 * One is the customer's failure to pay something they owed, and it belongs in
 * bad debt. The other is our decision that nothing was owed, and it belongs
 * nowhere at all. An accounts figure that adds them together is wrong by
 * exactly the amount somebody was wrongly billed, which is the one error
 * nobody looking at the total can spot.
 */
export function countsAsRevenue(status: InvoiceStatus): boolean {
  return status === 'paid';
}

export function isOutstanding(status: InvoiceStatus): boolean {
  return status === 'open';
}

/** Whether anything further will be attempted against this invoice. */
export function isSettled(status: InvoiceStatus): boolean {
  return status !== 'open';
}
