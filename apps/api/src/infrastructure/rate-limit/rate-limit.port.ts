/**
 * Request rate limiting, independent of where the counters live.
 *
 * Two implementations, both legitimate — the same arrangement as the queue.
 * Redis holds the counters wherever more than one process serves traffic; an
 * in-process map holds them on a laptop with no Redis. The callers, which are
 * the credential endpoints, do not care which.
 *
 * What this protects is narrow and worth stating: the endpoints where an
 * unauthenticated caller can spend somebody else's resources or guess at a
 * secret. Sign-in and MFA guess passwords and six-digit codes. Registration,
 * password reset and verification-resend all send email to an address the
 * caller chose, which is a way to use this system to deliver mail to a
 * stranger. Invitation acceptance guesses a token that grants standing access
 * to a vulnerable person's home address.
 *
 * It is deliberately *not* a general request-per-second throttle. That belongs
 * at the edge, where it can drop a flood without an application process
 * waking up for it.
 */

export const RATE_LIMITER = Symbol('RATE_LIMITER');

export interface RateLimitPolicy {
  /** Attempts permitted inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts left in the window. Zero once the limit is reached. */
  remaining: number;
  /**
   * How long until the window rolls over. Sent as `Retry-After`, so it is
   * measured in whole seconds and rounded up — a client told to wait 0 seconds
   * retries immediately and is refused again.
   */
  retryAfterSeconds: number;
}

export interface RateLimiterPort {
  /** Which implementation is live. Reported at boot. */
  readonly kind: 'redis' | 'in-process';

  /**
   * Count one attempt against `key` and say whether it is permitted.
   *
   * Counting happens whether or not the attempt is allowed: a caller hammering
   * a locked-out key keeps it locked out, which is the behaviour that makes
   * the limit worth having.
   */
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;

  /**
   * Read the state of `key` without counting an attempt against it.
   *
   * Sign-in needs this: only *failed* attempts are counted there, so the check
   * at the top of the flow has to be able to ask "has this pair run out"
   * without the asking itself being an attempt. Using `consume` for that would
   * lock out anyone who signed in successfully often enough.
   */
  peek(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;

  /**
   * Forget a key. Called after a *successful* sign-in, so that one person
   * getting their own password wrong three times and then right does not leave
   * a counter primed against them.
   */
  reset(key: string): Promise<void>;
}
