/**
 * What a family is told about a caregiver, and what they are not.
 *
 * The rule the whole marketplace is built around, from FOUNDATION §5A: **no
 * claim that platform checks replace background screening.** This file is
 * where that stops being a copy decision and becomes code.
 *
 * Two consequences follow, and both cost the platform something:
 *
 *   - A verification is presented as **a fact with a date** — "identity
 *     confirmed", "background check run on 3 March 2026" — never as a badge
 *     that means "safe". A family judges; the platform reports.
 *   - Verification is **not part of the rating**. Ranking by it would be the
 *     platform quietly asserting the thing it says it is not asserting.
 */

export type CaregiverStatus = 'applied' | 'verified' | 'suspended' | 'offboarded';

export const CAREGIVER_STATUSES: readonly CaregiverStatus[] = [
  'applied',
  'verified',
  'suspended',
  'offboarded',
];

const ALLOWED: Record<CaregiverStatus, readonly CaregiverStatus[]> = {
  applied: ['verified', 'offboarded'],
  verified: ['suspended', 'offboarded'],
  suspended: ['verified', 'offboarded'],
  offboarded: [],
};

export function canTransitionCaregiver(
  from: CaregiverStatus,
  to: CaregiverStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

/** Whether this caregiver may be found and booked. */
export function isBookable(status: CaregiverStatus): boolean {
  return status === 'verified';
}

/**
 * How old a background check may be before it is described as current.
 *
 * A year. Beyond that the fact is still shown — it is still true that a check
 * was run — but it is shown as what it is: old. Silently dropping it would be
 * hiding information from a family; presenting it as current would be worse.
 */
export const BACKGROUND_CHECK_FRESH_DAYS = 365;

export interface VerificationFacts {
  identityVerifiedAt: Date | null;
  backgroundCheckAt: Date | null;
}

export interface VerificationDisplay {
  identityConfirmed: boolean;
  backgroundCheckRun: boolean;
  backgroundCheckAgeDays: number | null;
  backgroundCheckIsRecent: boolean;
  /**
   * The sentence shown beneath a caregiver's name.
   *
   * Deliberately never contains the words "safe", "vetted", "approved" or
   * "guaranteed". It states what was done and when, and it says out loud that
   * this is not a substitute for the family's own judgement — because a family
   * choosing somebody to sit with their mother is entitled to know exactly how
   * much of the checking the platform actually did.
   */
  statement: string;
}

export function verificationDisplay(
  facts: VerificationFacts,
  now: Date,
): VerificationDisplay {
  const identityConfirmed = facts.identityVerifiedAt !== null;
  const backgroundCheckRun = facts.backgroundCheckAt !== null;

  const ageDays = facts.backgroundCheckAt
    ? Math.floor((now.getTime() - facts.backgroundCheckAt.getTime()) / (24 * 3_600_000))
    : null;

  const recent = ageDays !== null && ageDays <= BACKGROUND_CHECK_FRESH_DAYS;

  const parts: string[] = [];
  parts.push(
    identityConfirmed
      ? 'CareBridge has confirmed this person’s identity.'
      : 'CareBridge has not confirmed this person’s identity.',
  );

  if (!backgroundCheckRun) {
    parts.push('No background check is on file.');
  } else if (recent) {
    parts.push(`A background check was run ${describeAge(ageDays ?? 0)}.`);
  } else {
    parts.push(
      `A background check was run ${describeAge(ageDays ?? 0)}, which is more than a year ago.`,
    );
  }

  // The sentence that costs the platform something, and the reason this file
  // exists. Note the vocabulary it avoids: "safe", "vetted", "approved",
  // "trusted", "guaranteed". Not one of them appears anywhere in this module,
  // including inside a denial — a family skimming a profile reads the words,
  // not the grammar around them, and a test asserts their absence.
  parts.push(
    'These are records of what was checked, not a judgement about the person. Please meet anyone you are considering and decide for yourself.',
  );

  return {
    identityConfirmed,
    backgroundCheckRun,
    backgroundCheckAgeDays: ageDays,
    backgroundCheckIsRecent: recent,
    statement: parts.join(' '),
  };
}

/**
 * Takes a number rather than a nullable one.
 *
 * Every caller has already established that the check exists — a null would
 * mean the `backgroundCheckRun` branch above was wrong — so a guard here would
 * be a line no test can reach, and an unreachable line in the domain is a
 * hole in the coverage floor that exists to catch real ones.
 */
function describeAge(days: number): string {
  if (days <= 1) return 'today';
  if (days < 60) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

// ─── ratings ─────────────────────────────────────────────────────────────────

/**
 * The rating a new caregiver starts from, and how much it weighs.
 *
 * A plain average is unusable at the top of a marketplace: somebody's first
 * review decides their livelihood, one disappointed family can halve a
 * career, and five-star-after-one-booking outranks four-point-eight after two
 * hundred. So the average is pulled towards a prior — a Bayesian shrink — with
 * a weight of five reviews.
 *
 * Five is chosen so that the prior stops mattering quickly for anybody doing
 * real work, while a single review cannot move somebody to the top or the
 * bottom of a list.
 */
export const RATING_PRIOR = 4.2;
export const RATING_PRIOR_WEIGHT = 5;

/**
 * Reviews that count.
 *
 * Only from a booking that **completed**. A marketplace where a cancelled
 * engagement can be rated is one where a family who never met somebody can end
 * their career, and where a caregiver can farm ratings from bookings that
 * never happened.
 */
export function reviewIsEligible(bookingStatus: string): boolean {
  return bookingStatus === 'completed';
}

export interface ReputationSummary {
  reviewCount: number;
  /** The plain mean, shown alongside — a family may want the raw number. */
  rawAverage: number | null;
  /** What the marketplace sorts and displays. */
  rating: number | null;
  /**
   * Whether there are enough reviews to say anything at all.
   *
   * Below three, no rating is shown. A number derived from one opinion looks
   * exactly like a number derived from a hundred, and the difference is the
   * whole information.
   */
  hasEnoughReviews: boolean;
}

export const MINIMUM_REVIEWS_TO_DISPLAY = 3;

export function reputationOf(ratings: readonly number[]): ReputationSummary {
  if (ratings.length === 0) {
    return {
      reviewCount: 0,
      rawAverage: null,
      rating: null,
      hasEnoughReviews: false,
    };
  }

  const sum = ratings.reduce((total, rating) => total + rating, 0);
  const rawAverage = sum / ratings.length;

  const shrunk =
    (sum + RATING_PRIOR * RATING_PRIOR_WEIGHT) / (ratings.length + RATING_PRIOR_WEIGHT);

  return {
    reviewCount: ratings.length,
    rawAverage: round1(rawAverage),
    rating: round1(shrunk),
    hasEnoughReviews: ratings.length >= MINIMUM_REVIEWS_TO_DISPLAY,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The 80% one-sided normal quantile. Confident enough to be conservative,
 * loose enough that three good reviews are worth something.
 */
const Z = 1.2816;

/**
 * The score a search orders by — a Wilson lower bound, **not** the displayed
 * rating.
 *
 * The two are different on purpose, and the reason is a real defect in the
 * obvious approach. The displayed rating shrinks towards a prior, which is
 * right for *display*: it stops one bad review halving a career. But shrinkage
 * pulls in both directions, so somebody with fifty honest fours scores *below*
 * somebody with three, because the prior is 4.2 and more evidence drags them
 * down towards their own true average. Ordering a marketplace that way tells a
 * family the person with less of a record is the better bet.
 *
 * A lower confidence bound has the property that actually matters here: more
 * evidence never hurts a good record, and a single five-star review cannot
 * outrank two hundred of them. Wilson rather than a normal approximation
 * because a perfect score has zero variance, and the normal form would rate
 * one flawless review as highly as two hundred.
 *
 * Somebody with **no** reviews scores at the prior rather than at zero. A new
 * caregiver who is never seen never gets a first review, and a marketplace
 * that buries every newcomer has no supply next year.
 */
export function searchScore(summary: ReputationSummary): number {
  if (summary.reviewCount === 0 || summary.rawAverage === null) {
    return RATING_PRIOR;
  }

  // Ratings are one-to-five; the bound wants a proportion.
  const p = (summary.rawAverage - 1) / 4;
  const n = summary.reviewCount;

  const denominator = 1 + (Z * Z) / n;
  const centre = p + (Z * Z) / (2 * n);
  const margin = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  const lower = (centre - margin) / denominator;

  return 1 + 4 * Math.max(0, lower);
}

/**
 * How a search result list is ordered.
 *
 * By [searchScore], then by how much of a record it rests on — so that between
 * two caregivers whose evidence is equally strong, the one a family can
 * actually judge comes first.
 *
 * **Verification is not in here.** Ranking by it would be the platform quietly
 * asserting the safety claim it has just said it is not making, and the
 * comparison cannot even see it: a [ReputationSummary] carries no
 * verification field.
 */
export function compareForSearch(a: ReputationSummary, b: ReputationSummary): number {
  const byScore = searchScore(b) - searchScore(a);
  if (Math.abs(byScore) > 0.001) return byScore;
  return b.reviewCount - a.reviewCount;
}
