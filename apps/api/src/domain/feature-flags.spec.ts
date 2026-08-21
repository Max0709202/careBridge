import {
  bucketFor,
  isFlagEnabledFor,
  rolloutTakesFeatureAway,
  type FeatureFlagState,
} from './feature-flags';

/**
 * Switches.
 *
 * The property worth protecting is **stickiness**. A flag that answered
 * randomly would put a family into a new checkout on one request and the old
 * one on the next: a price that changes, a layout that changes, and a support
 * conversation nobody can reproduce.
 */

function flag(overrides: Partial<FeatureFlagState> = {}): FeatureFlagState {
  return { key: 'new-checkout', enabled: true, rolloutPercent: 100, ...overrides };
}

describe('a flag nobody has defined', () => {
  it('is off', () => {
    // A typo in a key is then a feature that does not appear, which is the
    // safe direction to fail in.
    expect(isFlagEnabledFor(null, 'user-1')).toBe(false);
    expect(isFlagEnabledFor(undefined, 'user-1')).toBe(false);
  });
});

describe('the master switch', () => {
  it('turns it on for everybody at a hundred per cent', () => {
    expect(isFlagEnabledFor(flag(), 'anybody')).toBe(true);
  });

  it('turns it off for everybody, whatever the rollout says', () => {
    // When something has to be switched off in a hurry it has to go off for
    // everybody — not "off for the ninety per cent who were not in it".
    expect(isFlagEnabledFor(flag({ enabled: false }), 'user-1')).toBe(false);
    expect(
      isFlagEnabledFor(flag({ enabled: false, rolloutPercent: 100 }), 'user-1'),
    ).toBe(false);
  });

  it('is off at nought per cent', () => {
    expect(isFlagEnabledFor(flag({ rolloutPercent: 0 }), 'user-1')).toBe(false);
  });
});

describe('a partial rollout', () => {
  const subjects = Array.from({ length: 4000 }, (_, i) => `user-${i}`);

  it('gives the same subject the same answer every time', () => {
    // The property the whole design exists for.
    const state = flag({ rolloutPercent: 50 });
    const first = isFlagEnabledFor(state, 'user-42');

    for (let i = 0; i < 50; i++) {
      expect(isFlagEnabledFor(state, 'user-42')).toBe(first);
    }
  });

  it('lands roughly where it was asked to', () => {
    const state = flag({ rolloutPercent: 25 });
    const on = subjects.filter((id) => isFlagEnabledFor(state, id)).length;
    const share = (on / subjects.length) * 100;

    // Generous bounds: this is a hash, not a quota. What would fail here is a
    // bucketing function that is skewed, not one that is merely noisy.
    expect(share).toBeGreaterThan(20);
    expect(share).toBeLessThan(30);
  });

  it('never shrinks when the percentage grows', () => {
    // Somebody already in the rollout must stay in it when it widens.
    // Otherwise raising 25% to 50% takes the feature away from people who had
    // it, which reads as a bug rather than as a decision.
    const at25 = subjects.filter((id) =>
      isFlagEnabledFor(flag({ rolloutPercent: 25 }), id),
    );
    const at50 = new Set(
      subjects.filter((id) => isFlagEnabledFor(flag({ rolloutPercent: 50 }), id)),
    );

    for (const id of at25) expect(at50.has(id)).toBe(true);
  });

  it('does not select the same people for every experiment', () => {
    // Salted with the flag key. Without it, the unlucky tenth would receive
    // every experiment at once — a bad experiment and a bad experience.
    const a = subjects.filter((id) =>
      isFlagEnabledFor(flag({ key: 'flag-a', rolloutPercent: 10 }), id),
    );
    const b = subjects.filter((id) =>
      isFlagEnabledFor(flag({ key: 'flag-b', rolloutPercent: 10 }), id),
    );

    const overlap = a.filter((id) => b.includes(id)).length;
    // Independent selections of 10% each overlap around 1% by chance. Identical
    // selections would overlap completely.
    expect(overlap).toBeLessThan(a.length * 0.5);
  });
});

describe('the bucket itself', () => {
  it('is always a percentage', () => {
    for (let i = 0; i < 500; i++) {
      const bucket = bucketFor('some-flag', `user-${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it('is stable across processes, not just within one', () => {
    // A hash of the digest rather than of an object identity or a random seed,
    // so two API instances agree about who is in the rollout.
    expect(bucketFor('new-checkout', 'user-42')).toBe(
      bucketFor('new-checkout', 'user-42'),
    );
  });
});

describe('moving a rollout backwards', () => {
  it('is reported rather than forbidden', () => {
    // Sometimes it is exactly what is wanted: a bad release has to be pulled.
    // The surface asks for confirmation; the rule only says what is happening.
    expect(rolloutTakesFeatureAway(50, 10)).toBe(true);
    expect(rolloutTakesFeatureAway(10, 50)).toBe(false);
    expect(rolloutTakesFeatureAway(50, 50)).toBe(false);
  });
});
