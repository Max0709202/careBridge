import {
  INVOICE_REASONS,
  INVOICE_STATUSES,
  countsAsRevenue,
  isOutstanding,
  isSettled,
  type InvoiceStatus,
} from './invoicing';

describe('the invoice vocabulary', () => {
  it('names the three things that raise money', () => {
    expect(INVOICE_REASONS).toEqual([
      'subscriptionPeriod',
      'seatProration',
      'intervalSwitch',
    ]);
  });

  it('names every status', () => {
    expect(INVOICE_STATUSES).toEqual(['open', 'paid', 'uncollectible', 'void']);
  });
});

describe('what counts as revenue', () => {
  it('is only what was actually paid', () => {
    expect(countsAsRevenue('paid')).toBe(true);
  });

  // The distinction the whole file exists for. `uncollectible` is bad debt —
  // owed, pursued, not recovered. `void` was never owed and belongs nowhere.
  // A total that adds them together is wrong by exactly the amount somebody
  // was wrongly billed, which is the one error nobody can spot in the total.
  it.each(['open', 'uncollectible', 'void'] as const)('excludes %s', (status) => {
    expect(countsAsRevenue(status)).toBe(false);
  });
});

describe('what is still owed', () => {
  it('is open, and nothing else', () => {
    expect(isOutstanding('open')).toBe(true);
    for (const status of ['paid', 'uncollectible', 'void'] as const) {
      expect(isOutstanding(status)).toBe(false);
    }
  });

  it('treats everything but open as settled', () => {
    const settled = INVOICE_STATUSES.filter((s: InvoiceStatus) => isSettled(s));
    expect(settled).toEqual(['paid', 'uncollectible', 'void']);
  });
});
