/**
 * Money, for display only. A port of apps/ops_console/lib/core/money.dart.
 *
 * The console never does arithmetic on money — every figure was computed by
 * the server in integer cents. Cents in, never a float.
 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const remainder = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${Math.floor(abs / 100)}.${remainder}`;
}

/**
 * Dollars typed by a person, as integer cents — the single point where "12.34"
 * becomes 1234. Parsed as a decimal string rather than through a float, so
 * "0.29" is 29 and not 28.999….
 */
export function parseDollars(input: string): number | null {
  const text = input.trim().replace(/,/g, '').replace(/^\$/, '');
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match || (match[1] === '' && !match[2])) return null;
  const whole = match[1] === '' ? 0 : Number.parseInt(match[1]!, 10);
  const fraction = Number.parseInt((match[2] ?? '').padEnd(2, '0'), 10);
  return whole * 100 + fraction;
}

/** "24.50" — the form the refund field is pre-filled with. */
export const centsToInput = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
