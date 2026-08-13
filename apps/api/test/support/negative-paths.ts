import type { Response } from 'supertest';

import type { TestHarness } from './harness';
import { errorOf } from './harness';

/**
 * The negative-path helper set.
 *
 * FOUNDATION §9 makes these a **merge requirement**, not a nice-to-have, and
 * the reason is structural rather than procedural: authorisation bugs do not
 * announce themselves. A wrong-family read returns a 200 with somebody's home
 * address in it, and every positive test in the suite still passes. The only
 * thing that catches it is a test that asserts on what a caller *cannot* do.
 *
 * Each helper below covers one way the check can be wrong, and they are
 * separate because they fail for different reasons:
 *
 *   - `expectsAuthentication` — the endpoint forgot to be protected at all.
 *   - `expectsIndistinguishableDenial` — the endpoint checks access but leaks
 *     record existence through the error it returns.
 *   - `expectsRevocationTakesEffect` — the check reads a grant but not its
 *     `revokedAt`, so removing someone's access does nothing.
 *   - `expectsPermissionScope` — the check confirms *a* grant rather than the
 *     specific permission the operation needs.
 */

export type RequestFactory = (token: string | null) => Promise<Response>;

/** Statuses that mean "no", so a helper cannot be satisfied by a 500. */
const DENIALS = [401, 403, 404];

/**
 * An unauthenticated caller is refused.
 *
 * The global `AuthGuard` makes protection the default, so this fails only when
 * someone has added `@Public()` — which is exactly when it should fail.
 */
export async function expectsAuthentication(request: RequestFactory): Promise<void> {
  const response = await request(null);
  expect(response.status).toBe(401);
}

/**
 * "No such record" and "not permitted" are the same response.
 *
 * Asserted against a real record the caller may not see *and* an id that does
 * not exist, then compared. Checking only the status would pass while the
 * message said "you do not have access to this patient" — which answers the
 * question the ambiguity exists to refuse.
 */
export async function expectsIndistinguishableDenial(options: {
  /** A record that exists, belonging to somebody else. */
  forbidden: RequestFactory;
  /** An id of the same shape that does not exist at all. */
  missing: RequestFactory;
  token: string;
}): Promise<void> {
  const [forbidden, missing] = await Promise.all([
    options.forbidden(options.token),
    options.missing(options.token),
  ]);

  expect(DENIALS).toContain(forbidden.status);
  expect(forbidden.status).toBe(missing.status);

  const a = errorOf(forbidden);
  const b = errorOf(missing);

  expect(a.code).toBe(b.code);
  expect(a.message).toBe(b.message);

  // The message must not name the thing it is refusing to confirm exists.
  expect(a.message).not.toMatch(/permission|forbidden|not allowed|access denied/i);
}

/**
 * Revoking a grant closes the surface on the next request.
 *
 * Not at the next token expiry, and not on the next login: patient access is
 * resolved server-side per request precisely so that revocation is immediate.
 */
export async function expectsRevocationTakesEffect(options: {
  harness: TestHarness;
  userId: string;
  patientId: string;
  request: RequestFactory;
  token: string;
}): Promise<void> {
  const before = await options.request(options.token);
  expect(before.status).toBeLessThan(400);

  await options.harness.prisma.patientAccess.updateMany({
    where: { userId: options.userId, patientId: options.patientId },
    data: { revokedAt: new Date() },
  });

  const after = await options.request(options.token);
  expect(DENIALS).toContain(after.status);
}

/**
 * Holding *a* grant is not the same as holding *this* permission.
 *
 * The bug this catches is a service that calls `requirePermission` with the
 * wrong constant, or that checks only that a grant exists — a view-only family
 * member who can then book a car.
 */
export async function expectsPermissionScope(options: {
  harness: TestHarness;
  userId: string;
  patientId: string;
  /** The permission set to leave the caller with. */
  permissions: Array<
    | 'viewProfile'
    | 'scheduleAppointments'
    | 'requestTransport'
    | 'makePayments'
    | 'manageAccess'
  >;
  request: RequestFactory;
  token: string;
}): Promise<void> {
  await options.harness.prisma.patientAccess.updateMany({
    where: { userId: options.userId, patientId: options.patientId },
    data: { permissions: options.permissions },
  });

  const response = await options.request(options.token);
  expect(DENIALS).toContain(response.status);
}

/**
 * A single-use credential is single-use.
 *
 * Covers verification tokens, reset tokens and invitations, all of which are
 * consumed inside a transaction so that a double-click cannot spend one twice.
 */
export async function expectsSingleUse(options: {
  /** Runs the redemption. Called twice with the same token. */
  redeem: () => Promise<Response>;
}): Promise<void> {
  const first = await options.redeem();
  expect(first.status).toBeLessThan(400);

  const second = await options.redeem();
  expect(second.status).toBeGreaterThanOrEqual(400);
}
