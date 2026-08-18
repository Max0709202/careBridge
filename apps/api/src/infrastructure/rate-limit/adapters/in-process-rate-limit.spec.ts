import { InProcessRateLimitAdapter } from './in-process-rate-limit.adapter';

describe('in-process rate limiter', () => {
  const policy = { limit: 3, windowMs: 60_000 };

  let now = 1_000_000;
  const clock = () => now;
  let limiter: InProcessRateLimitAdapter;

  beforeEach(() => {
    now = 1_000_000;
    limiter = new InProcessRateLimitAdapter(clock);
  });

  it('allows exactly the limit and refuses the next one', async () => {
    const first = await limiter.consume('a', policy);
    expect(first).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 60 });

    await limiter.consume('a', policy);
    const third = await limiter.consume('a', policy);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    expect((await limiter.consume('a', policy)).allowed).toBe(false);
  });

  it('keeps counting past the limit, so hammering does not shorten the wait', async () => {
    for (let i = 0; i < 10; i += 1) await limiter.consume('a', policy);

    now += 30_000;
    expect((await limiter.peek('a', policy)).allowed).toBe(false);

    // The window is fixed from the first attempt, not extended by later ones:
    // 30 seconds have passed, so 30 remain.
    expect((await limiter.peek('a', policy)).retryAfterSeconds).toBe(30);
  });

  it('starts a fresh window once the old one has passed', async () => {
    for (let i = 0; i < 4; i += 1) await limiter.consume('a', policy);
    expect((await limiter.peek('a', policy)).allowed).toBe(false);

    now += policy.windowMs;
    expect((await limiter.peek('a', policy)).allowed).toBe(true);
    expect((await limiter.consume('a', policy)).remaining).toBe(2);
  });

  it('counts each key separately', async () => {
    for (let i = 0; i < 4; i += 1) await limiter.consume('a', policy);

    expect((await limiter.peek('a', policy)).allowed).toBe(false);
    expect((await limiter.peek('b', policy)).allowed).toBe(true);
  });

  it('peeks without spending an attempt', async () => {
    // The sign-in flow depends on this: it counts failures only, so the check
    // at the top of the flow must not itself be an attempt.
    for (let i = 0; i < 20; i += 1) {
      expect((await limiter.peek('a', policy)).allowed).toBe(true);
    }
    expect((await limiter.consume('a', policy)).remaining).toBe(2);
  });

  it('reports an untouched key as fully available', async () => {
    expect(await limiter.peek('never-seen', policy)).toEqual({
      allowed: true,
      remaining: 3,
      retryAfterSeconds: 60,
    });
  });

  it('forgets a key on reset', async () => {
    for (let i = 0; i < 4; i += 1) await limiter.consume('a', policy);
    expect((await limiter.peek('a', policy)).allowed).toBe(false);

    await limiter.reset('a');
    expect((await limiter.peek('a', policy)).allowed).toBe(true);
  });

  it('never tells a caller to retry in zero seconds', async () => {
    // A client told to wait 0 retries immediately and is refused again, which
    // reads as a broken endpoint rather than as a limit.
    await limiter.consume('a', policy);
    now += policy.windowMs - 1;

    expect((await limiter.peek('a', policy)).retryAfterSeconds).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('drops windows that are long past, rather than holding every key seen', async () => {
    await limiter.consume('old', policy);

    // Keys are attacker-chosen — an unbounded map is a slow leak. The sweep is
    // on write, so a later call is what clears the earlier one.
    now += 2 * 60 * 60 * 1000;
    await limiter.consume('new', policy);

    const windows = (limiter as unknown as { windows: Map<string, unknown> }).windows;
    expect(windows.has('old')).toBe(false);
    expect(windows.has('new')).toBe(true);
  });
});
