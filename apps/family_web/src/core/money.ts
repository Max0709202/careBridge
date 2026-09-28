/**
 * Money is held as integer cents, never as a float: 0.1 + 0.2 !== 0.3, and a
 * fare assembled from a base, a per-mile rate and a surcharge accumulates
 * exactly that error. Mirrors lib/core/money.dart.
 */

/**
 * Multiplies an amount by a rate, rounding half away from zero — the one point
 * where precision is lost, and the rounding the server uses. `Math.round`
 * rounds -0.5 towards +∞, which is why this does not use it directly.
 */
export function multiplyCents(cents: number, factor: number): number {
  const raw = cents * factor;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

/** "$12.00", "-$3.50". */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars}.${remainder}`;
}
