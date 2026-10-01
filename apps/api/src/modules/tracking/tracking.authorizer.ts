import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessQueries } from '../../common/access.queries';
import { isTerminalRideStatus } from '../../domain/ride-status';

/**
 * Who may watch a car move.
 *
 * FOUNDATION marks this a **P0 security surface**, and the reason is specific:
 * a live position is a vulnerable person's real-time physical location, and a
 * WebSocket is the one place in this system where an authorisation decision is
 * made *once* and then keeps paying out for as long as the socket stays open.
 * Every other endpoint re-authorises on every request because every request
 * carries its own token. A subscription does not.
 *
 * So this class exists rather than an inline check, and it is written to be
 * called repeatedly — the gateway re-runs it on a timer for every open room,
 * not just at subscribe time. Three things change underneath a long-lived
 * socket and each of them must close the stream:
 *
 *   1. the ride finishes;
 *   2. the watcher's access to the patient is revoked;
 *   3. the watcher's session is ended everywhere (handled by the gateway
 *      re-verifying the token, which checks `tokenVersion`).
 *
 * The answer is deliberately a boolean rather than a reason. A caller who is
 * refused learns only that they are refused — the same rule that makes "not
 * found" and "not permitted" one response everywhere else, and for the same
 * reason: a ride id must never be usable to discover whose ride it is.
 */
@Injectable()
export class TrackingAuthorizer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessQueries,
  ) {}

  /**
   * Whether `userId` may currently receive positions for `rideId`.
   *
   * Two ways to qualify, and they are genuinely different relationships:
   *
   *   - **a family member** with an active grant carrying `viewProfile` on the
   *     patient — the same grant that lets them open the ride at all;
   *   - **a dispatcher** at the operator the ride is assigned to, who needs to
   *     see the car to do the job the console exists for.
   *
   * A driver would be the third, once there is a driver app. There is not, so
   * there is deliberately no branch for one: an unreachable authorisation
   * branch is a branch nobody tests and everybody trusts.
   */
  async canWatch(userId: string, rideId: string): Promise<boolean> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        patientId: true,
        status: true,
        driver: { select: { organizationId: true } },
      },
    });

    if (!ride) return false;

    // A finished ride stops being watchable the moment it finishes, not when
    // its last position expires. FOUNDATION's acceptance criterion for this
    // stage names it directly: "location writes stop within seconds of
    // completion and are rejected thereafter" — and reading is the same rule.
    if (isTerminalRideStatus(ride.status)) return false;

    if (await this.access.hasFamilyAccess(userId, ride.patientId)) return true;

    const organizationId = ride.driver?.organizationId;
    if (!organizationId) return false;

    // `member` is excluded on purpose: holding a membership is not the same as
    // having a reason to watch somebody's grandmother travel.
    return this.access.dispatchesFor(userId, organizationId);
  }
}
