import type {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimiterPort,
} from '../rate-limit.port';

interface Window {
  count: number;
  startedAtMs: number;
}

/**
 * Counters in the memory of one process.
 *
 * Correct for exactly one API instance, and wrong the moment there are two:
 * each holds its own counters, so a limit of 8 becomes 8 per instance and a
 * caller who reconnects gets a fresh allowance. Config validation refuses a
 * production boot without Redis for this reason, and the module logs which
 * adapter is live at startup rather than leaving it to be inferred.
 *
 * Expired windows are swept on write rather than on a timer: a timer keeps a
 * reference to every key forever, and this map is written to on exactly the
 * requests that would grow it.
 */
export class InProcessRateLimitAdapter implements RateLimiterPort {
  readonly kind = 'in-process' as const;

  private readonly windows = new Map<string, Window>();

  /**
   * Sweep at most this often. Sweeping on every call is O(n) per request; not
   * sweeping at all is a slow leak keyed by attacker-chosen strings.
   */
  private static readonly SWEEP_INTERVAL_MS = 60_000;
  private lastSweepMs = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const nowMs = this.now();
    this.sweep(nowMs);

    const existing = this.windows.get(key);
    const window =
      existing && nowMs - existing.startedAtMs < policy.windowMs
        ? existing
        : { count: 0, startedAtMs: nowMs };

    window.count += 1;
    this.windows.set(key, window);

    const elapsedMs = nowMs - window.startedAtMs;
    return {
      allowed: window.count <= policy.limit,
      remaining: Math.max(0, policy.limit - window.count),
      retryAfterSeconds: Math.max(1, Math.ceil((policy.windowMs - elapsedMs) / 1000)),
    };
  }

  async peek(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const nowMs = this.now();
    const window = this.windows.get(key);

    if (!window || nowMs - window.startedAtMs >= policy.windowMs) {
      return {
        allowed: true,
        remaining: policy.limit,
        retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
      };
    }

    const elapsedMs = nowMs - window.startedAtMs;
    return {
      allowed: window.count < policy.limit,
      remaining: Math.max(0, policy.limit - window.count),
      retryAfterSeconds: Math.max(1, Math.ceil((policy.windowMs - elapsedMs) / 1000)),
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweepMs < InProcessRateLimitAdapter.SWEEP_INTERVAL_MS) return;
    this.lastSweepMs = nowMs;

    // The longest window any policy uses is bounded by configuration; an hour
    // is comfortably past all of them, and a window kept slightly too long
    // only ever errs towards limiting.
    const horizonMs = 60 * 60 * 1000;
    for (const [key, window] of this.windows) {
      if (nowMs - window.startedAtMs > horizonMs) this.windows.delete(key);
    }
  }
}
