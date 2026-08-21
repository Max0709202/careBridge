import { createHash } from 'node:crypto';

/**
 * Whether a switch is on, for one subject.
 *
 * The whole difficulty in a percentage rollout is **stickiness**. A flag that
 * answered randomly would put a family into a new checkout on one request and
 * the old one on the next; they would see a price change, a layout change, and
 * a support conversation nobody can reproduce. So the answer is derived from a
 * hash of the subject rather than from chance: the same person is on the same
 * side of the line on every request, on every instance, until somebody moves
 * the line.
 *
 * Pure, and takes the subject rather than reading one, because "which bucket
 * is this user in" has to be answerable in a test without a request.
 */
export interface FeatureFlagState {
  key: string;
  enabled: boolean;
  /** 0–100. Applied only when `enabled` is true. */
  rolloutPercent: number;
}

/**
 * The bucket a subject falls in for a given flag: 0–99.
 *
 * Salted with the flag key so two flags at 10% do not select the *same* ten
 * per cent of users. Without the salt, the unlucky tenth would receive every
 * experiment at once, which is both a bad experiment and a bad experience.
 */
export function bucketFor(key: string, subjectId: string): number {
  const digest = createHash('sha256').update(`${key}:${subjectId}`).digest();
  // Four bytes is far more resolution than a hundred buckets needs; taking a
  // whole word avoids the modulo bias a single byte would introduce.
  return digest.readUInt32BE(0) % 100;
}

/**
 * Whether this flag is on for this subject.
 *
 * `enabled` is a master switch checked first, so turning a flag off is
 * instant and complete rather than "off for the ninety per cent who were not
 * in the rollout". When something has to be switched off in a hurry, it has to
 * go off for everybody.
 */
export function isFlagEnabledFor(
  flag: FeatureFlagState | null | undefined,
  subjectId: string,
): boolean {
  // An unknown flag is off. A typo in a key is then a feature that does not
  // appear, which is the safe direction to fail in.
  if (!flag) return false;
  if (!flag.enabled) return false;
  if (flag.rolloutPercent >= 100) return true;
  if (flag.rolloutPercent <= 0) return false;

  return bucketFor(flag.key, subjectId) < flag.rolloutPercent;
}

/**
 * Whether a rollout may move from one percentage to another.
 *
 * Only ever refuses a *decrease*, and only advises: a rollout that goes
 * backwards takes a feature away from people who already had it, which reads
 * to them as a bug rather than as a decision. Sometimes that is exactly what is
 * wanted — a bad release has to be pulled — so this reports rather than
 * forbids, and the surface asks for confirmation.
 */
export function rolloutTakesFeatureAway(from: number, to: number): boolean {
  return to < from;
}
