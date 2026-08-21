import {
  BACKGROUND_CHECK_FRESH_DAYS,
  MINIMUM_REVIEWS_TO_DISPLAY,
  RATING_PRIOR,
  canTransitionCaregiver,
  compareForSearch,
  isBookable,
  reputationOf,
  reviewIsEligible,
  searchScore,
  verificationDisplay,
} from './caregiver-reputation';

/**
 * What a family is told, and what they are not.
 *
 * FOUNDATION §5A: **no claim that platform checks replace background
 * screening.** These tests are where that stops being a copy decision. The
 * important ones assert on *absence* — that certain words never appear, and
 * that verification never touches the ordering.
 */

const now = new Date('2026-06-15T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3_600_000);

describe('what the platform says about a person', () => {
  it('states a check as a fact with a date', () => {
    const display = verificationDisplay(
      { identityVerifiedAt: daysAgo(200), backgroundCheckAt: daysAgo(30) },
      now,
    );

    expect(display.statement).toMatch(/confirmed this person’s identity/i);
    expect(display.statement).toMatch(/30 days ago/);
  });

  it('never calls anybody safe, vetted, approved or guaranteed', () => {
    // The sentence that costs the platform something. A family choosing
    // somebody to sit with their mother is entitled to know exactly how much
    // of the checking was actually done.
    for (const facts of [
      { identityVerifiedAt: daysAgo(1), backgroundCheckAt: daysAgo(1) },
      { identityVerifiedAt: null, backgroundCheckAt: null },
      { identityVerifiedAt: daysAgo(400), backgroundCheckAt: daysAgo(900) },
    ]) {
      const statement = verificationDisplay(facts, now).statement.toLowerCase();
      // Not one of these appears anywhere, including inside a denial. A
      // family skimming a profile reads the words, not the grammar.
      for (const word of ['safe', 'vetted', 'approved', 'guarantee', 'trusted']) {
        expect(statement).not.toContain(word);
      }
    }
  });

  it('says out loud that the family must judge for themselves', () => {
    const display = verificationDisplay(
      { identityVerifiedAt: daysAgo(10), backgroundCheckAt: daysAgo(10) },
      now,
    );
    expect(display.statement).toMatch(/decide for yourself/i);
    expect(display.statement).toMatch(/not a judgement about the person/i);
  });

  it('says plainly when nothing has been checked', () => {
    const display = verificationDisplay(
      { identityVerifiedAt: null, backgroundCheckAt: null },
      now,
    );

    expect(display.identityConfirmed).toBe(false);
    expect(display.statement).toMatch(/has not confirmed/i);
    expect(display.statement).toMatch(/no background check/i);
  });

  it('shows an old check as old rather than hiding it', () => {
    // Dropping it would hide information from a family; presenting it as
    // current would be worse.
    const display = verificationDisplay(
      {
        identityVerifiedAt: daysAgo(800),
        backgroundCheckAt: daysAgo(BACKGROUND_CHECK_FRESH_DAYS + 30),
      },
      now,
    );

    expect(display.backgroundCheckRun).toBe(true);
    expect(display.backgroundCheckIsRecent).toBe(false);
    expect(display.statement).toMatch(/more than a year ago/i);
  });
});

describe('the caregiver lifecycle', () => {
  it('does not let somebody be booked before they are verified', () => {
    expect(isBookable('applied')).toBe(false);
    expect(isBookable('verified')).toBe(true);
    expect(isBookable('suspended')).toBe(false);
    expect(isBookable('offboarded')).toBe(false);
  });

  it('allows a suspension to be lifted, and offboarding to be final', () => {
    expect(canTransitionCaregiver('suspended', 'verified')).toBe(true);
    expect(canTransitionCaregiver('offboarded', 'verified')).toBe(false);
  });

  it('does not allow verification to be skipped from nothing', () => {
    expect(canTransitionCaregiver('applied', 'suspended')).toBe(false);
  });
});

describe('which reviews count', () => {
  it('takes only completed bookings', () => {
    // A marketplace where a cancelled engagement can be rated is one where a
    // family who never met somebody can end their career — and where a
    // caregiver can farm ratings from bookings that never happened.
    expect(reviewIsEligible('completed')).toBe(true);
    for (const status of [
      'requested',
      'confirmed',
      'inProgress',
      'cancelledByFamily',
      'cancelledByCaregiver',
      'noShow',
    ]) {
      expect(reviewIsEligible(status)).toBe(false);
    }
  });
});

describe('the rating', () => {
  it('says nothing at all below three reviews', () => {
    // A number from one opinion looks exactly like a number from a hundred,
    // and the difference is the whole information.
    expect(reputationOf([5]).hasEnoughReviews).toBe(false);
    expect(reputationOf([5, 5]).hasEnoughReviews).toBe(false);
    expect(reputationOf([5, 5, 4]).hasEnoughReviews).toBe(true);
    expect(MINIMUM_REVIEWS_TO_DISPLAY).toBe(3);
  });

  it('does not let one bad review halve a career', () => {
    // A plain average of a single 1 is 1.0. Shrunk towards the prior it is
    // still poor and still recoverable.
    const plain = reputationOf([1]);
    expect(plain.rawAverage).toBe(1);
    expect(plain.rating!).toBeGreaterThan(3);
  });

  it('does not let one perfect review outrank a long good record', () => {
    const newcomer = reputationOf([5]);
    const veteran = reputationOf(
      Array.from({ length: 200 }, () => 4.8).map(Math.round),
    );

    expect(veteran.rating!).toBeGreaterThan(newcomer.rating!);
  });

  it('converges on the true average once there is a real record', () => {
    const many = reputationOf(Array.from({ length: 500 }, () => 4));
    expect(many.rating!).toBeCloseTo(4, 1);
  });

  it('shows the plain mean alongside, for a family who wants it', () => {
    const summary = reputationOf([5, 4, 3]);
    expect(summary.rawAverage).toBe(4);
    expect(summary.rating).not.toBe(summary.rawAverage);
  });

  it('has nothing to say about somebody with no reviews', () => {
    const summary = reputationOf([]);
    expect(summary.rating).toBeNull();
    expect(summary.rawAverage).toBeNull();
    expect(summary.reviewCount).toBe(0);
  });
});

describe('ordering a search', () => {
  it('puts the better-rated first', () => {
    const good = reputationOf([5, 5, 5, 5, 5]);
    const fair = reputationOf([3, 3, 3, 3, 3]);
    expect(compareForSearch(good, fair)).toBeLessThan(0);
  });

  it('never punishes somebody for having a longer record', () => {
    // The defect that made the search score a separate thing from the
    // displayed rating. Shrinkage towards a prior of 4.2 drags a long, honest
    // record of fours *down* towards its own average, so fifty fours scored
    // below three — telling a family that the person with less of a record was
    // the better bet.
    const many = reputationOf(Array.from({ length: 50 }, () => 4));
    const few = reputationOf([4, 4, 4]);

    expect(compareForSearch(many, few)).toBeLessThan(0);
    expect(searchScore(many)).toBeGreaterThan(searchScore(few));
  });

  it('does not let a single flawless review outrank two hundred', () => {
    // Wilson rather than a normal approximation, because a perfect score has
    // zero variance and the normal form would rate one review as highly as a
    // career.
    const newcomer = reputationOf([5]);
    const veteran = reputationOf(Array.from({ length: 200 }, () => 5));

    expect(searchScore(veteran)).toBeGreaterThan(searchScore(newcomer) + 1);
  });

  it('places somebody with no reviews at the prior, not at the bottom', () => {
    // A new caregiver who is never seen never gets a first review, and a
    // marketplace that buries every newcomer has no supply next year.
    const unrated = reputationOf([]);
    const poor = reputationOf([2, 2, 2, 2, 2]);
    expect(compareForSearch(unrated, poor)).toBeLessThan(0);
    expect(RATING_PRIOR).toBeGreaterThan(2);
  });

  it('does not rank by verification', () => {
    // Ranking by it would be the platform quietly asserting the safety claim
    // it has just said it is not making. The comparison cannot even see it.
    const summary = reputationOf([4, 4, 4]);
    expect(compareForSearch(summary, summary)).toBe(0);
    expect(Object.keys(summary)).not.toContain('identityConfirmed');
  });
});
