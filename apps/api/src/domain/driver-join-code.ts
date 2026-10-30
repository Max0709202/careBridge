import { randomInt } from 'node:crypto';

/**
 * The code a driver types into the driver app to apply to an operator.
 *
 * Read aloud over the telephone and copied off a printed sheet, so it uses no
 * letter or digit that is mistaken for another (0/O, 1/I/L) and is shown as two
 * groups of four. Eight characters from this alphabet is about 10^12
 * possibilities, and applying is rate-limited per account — guessing one is
 * not a way onto somebody's roster, and a guess that worked would still only
 * produce an application the operator has to approve.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** "K7QM-2RXD" for display; stored without the hyphen. */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * What was typed, as stored, or null if it cannot be a code at all. Forgiving
 * about case, spaces and hyphens; anything outside the alphabet — which
 * includes every look-alike — cannot be part of a code.
 */
export function normalizeJoinCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== LENGTH) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}
