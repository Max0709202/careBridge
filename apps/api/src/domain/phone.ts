/**
 * Phone numbers, as far as a relay call needs them.
 *
 * Deliberately small. The relay needs one thing from a stored number: an
 * E.164 string the provider will dial, or a clear "this cannot be dialled".
 * Numbers in this system are typed by families into a free-text field — "(555)
 * 010-0100", "555.010.0100 ext 2", "+44 20 7946 0000" — and are never
 * rewritten in storage, so normalising happens at dial time, here.
 *
 * Not a full numbering-plan validator. A number that normalises but does not
 * exist fails at the provider, and the call is recorded as failed; what this
 * must never do is turn a malformed entry into a *different* real number.
 */

/** E.164 allows at most fifteen digits; below eight is not a subscriber number anywhere. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * `+` then digits, or null.
 *
 * Rules, in order:
 *   - an extension ("ext", "x", "#") is dropped — a relay cannot dial one;
 *   - a leading `+` or `00` means the country code is already there;
 *   - otherwise a national number gets `defaultCountryCode`, with the NANP
 *     special case that 11 digits starting with 1 already carry it;
 *   - letters anywhere else mean it is not a phone number.
 */
export function normalizeE164(
  raw: string | null | undefined,
  defaultCountryCode: string,
): string | null {
  if (!raw) return null;

  const withoutExtension = raw.split(/\s*(?:ext\.?|extension|x|#)\s*\d*\s*$/i)[0] ?? '';
  const trimmed = withoutExtension.trim();
  if (trimmed.length === 0) return null;
  if (/[a-z]/i.test(trimmed)) return null;

  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);

  if (!international) {
    if (defaultCountryCode === '1' && digits.length === 11 && digits.startsWith('1')) {
      // Already carries the NANP country code.
    } else {
      // A trunk prefix ("0" in most of Europe) is not dialled internationally.
      digits = defaultCountryCode + digits.replace(/^0+/, '');
    }
  }

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  if (digits.startsWith('0')) return null;
  // The North American plan has exactly ten national digits, however the
  // number was written. The seed data's "+1-555-0100" style is exactly the
  // short form this catches.
  if (digits.startsWith('1') && digits.length !== 11) return null;

  return `+${digits}`;
}
