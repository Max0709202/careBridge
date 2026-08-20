import { DateTime } from 'luxon';

/**
 * What happens after a card is declined. Mirrors lib/domain/dunning.dart.
 *
 * The temptation with a failed payment is to retry it hard — the money is
 * owed, and each retry is nearly free. Both halves of that are wrong. Card
 * networks price and score reattempts, and an issuer that sees the same
 * declined card presented every hour treats the merchant, not the card, as the
 * problem. And on this product the person being retried is frequently an adult
 * child managing a parent's logistics around a job; the useful signal is one
 * clear email, not four charges in a morning.
 *
 * So retries are few, spaced, and stop. What keeps the family whole in the
 * meantime is not the retry schedule — it is the grace window in `billing.ts`,
 * which keeps live tracking on while this plays out.
 */

/**
 * Days after the first failure at which each subsequent attempt is made.
 *
 * Four attempts across six days, and the shape is deliberate: the first retry
 * is a day later because the most common cause is a card momentarily over its
 * limit, and the last is nearly a week later because the second most common
 * cause is a replacement card that has not arrived yet. Retrying five minutes
 * later solves neither and costs a network reattempt fee.
 *
 * The **last** attempt is the one that is pinned rather than chosen. It must
 * land inside the shortest grace window any plan offers — seven days, on the
 * family plans — because the cycle sweep expires a subscription the moment its
 * grace closes. A schedule reaching past that would have its final retry
 * scheduled against a subscription that no longer exists: a charge silently
 * never attempted, on the one account that most needed the reminder. Held by
 * a test, so lengthening this list fails rather than quietly loses an attempt.
 */
export const DUNNING_SCHEDULE_DAYS: readonly number[] = [1, 3, 6];

/**
 * The shortest grace window in the catalogue, from `SubscriptionPlan.graceDays`
 * on the family plans. Duplicated here as a bound rather than imported,
 * because what this file needs is the *guarantee*, and a seed that lowers a
 * plan's grace below it should fail this file's test rather than silently
 * shorten dunning.
 */
export const SHORTEST_GRACE_DAYS = 7;

/** The first attempt is made at once; the schedule covers the retries. */
export const MAX_PAYMENT_ATTEMPTS = DUNNING_SCHEDULE_DAYS.length + 1;

/**
 * Why an attempt failed, reduced to the only distinction that changes what we
 * do next.
 *
 * `terminal` is a decline that says the card will never work: closed, stolen,
 * or reported lost. Retrying one of those three more times over eight days
 * cannot succeed, and each attempt against a card reported stolen is a fraud
 * signal recorded against us. `retryable` is everything else, including the
 * unhelpfully vague ones — when the issuer will not say, the safe reading is
 * that it might work later.
 */
export type DeclineKind = 'retryable' | 'terminal';

/**
 * Decline codes that mean "stop". Deliberately short: a code we do not
 * recognise is treated as retryable, because the cost of one wasted retry is
 * far below the cost of cancelling a subscription that would have paid.
 */
const TERMINAL_DECLINE_CODES: ReadonlySet<string> = new Set([
  'card_declined_stolen_card',
  'card_declined_lost_card',
  'card_declined_pickup_card',
  'card_declined_revocation_of_authorization',
  'invalid_account',
  'account_closed',
]);

export function classifyDecline(code: string | null | undefined): DeclineKind {
  if (!code) return 'retryable';
  return TERMINAL_DECLINE_CODES.has(code) ? 'terminal' : 'retryable';
}

export interface DunningState {
  /** Attempts already made, including the first. */
  attempts: number;
  /** When the first attempt failed. */
  firstFailedAt: Date;
  /** How the most recent attempt failed. */
  decline: DeclineKind;
}

/**
 * When to try again, or null when we are done trying.
 *
 * Null has two causes and they are not the same event, which is why
 * `isExhausted` and `classifyDecline` stay separate: a schedule that has run
 * out ends in an expired subscription, and a terminal decline ends in one
 * immediately. Both stop the retries; only the reason differs in the email.
 */
export function nextAttemptAt(state: DunningState): Date | null {
  if (state.decline === 'terminal') return null;
  if (isExhausted(state.attempts)) return null;

  // `attempts` includes the first, so attempt 1 maps to schedule index 0.
  // Written as an expression rather than a guard statement: the index cannot
  // be out of range once `isExhausted` has passed, but
  // `noUncheckedIndexedAccess` types it as possibly undefined, and a
  // defensive `if` would be an unreachable statement the domain's 100%
  // threshold could never cover.
  const offsetDays = DUNNING_SCHEDULE_DAYS[state.attempts - 1];

  return offsetDays == null
    ? null
    : DateTime.fromJSDate(state.firstFailedAt, { zone: 'utc' })
        .plus({ days: offsetDays })
        .toJSDate();
}

export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_PAYMENT_ATTEMPTS;
}

/**
 * Whether an attempt is due now.
 *
 * `null` means the schedule is over, and an over schedule is never due — the
 * caller expires the subscription instead. Written as an explicit branch
 * rather than a comparison against a null date, because `now >= null` coerces
 * to a comparison against zero and would report every finished schedule as
 * permanently due.
 */
export function isAttemptDue(state: DunningState, now: Date): boolean {
  const due = nextAttemptAt(state);
  if (due == null) return false;
  return now.getTime() >= due.getTime();
}
