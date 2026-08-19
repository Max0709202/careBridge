import { Injectable } from '@nestjs/common';
import type { OrganizationMembership, OrgRole, Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationError, NotFoundError } from '../../common/errors';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * The organisation half of the authorisation model.
 *
 * CareBridge scopes almost everything by a *patient relationship*, not by a
 * tenant — a family member has no organisation and a dispatcher has no patient
 * grants (docs/architecture/multi-tenancy.md). This service answers the other
 * axis, and it is deliberately the only place that does, for the same reason
 * `CareService.requirePermission` is the only place the patient axis is
 * answered: two implementations of an authorisation rule eventually disagree.
 *
 * The rule that made this file necessary is a billing one. An operator's
 * invoice is a document about their drivers and their money, and "who at the
 * dispatch company may see it" is not answerable from a patient grant.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every organisation the caller currently belongs to.
   *
   * Revoked memberships are excluded here rather than filtered by the caller —
   * data the caller has no membership for never enters the result set, which
   * is the same discipline the patient queries use.
   */
  async membershipsFor(userId: string, db: Db = this.prisma) {
    return db.organizationMembership.findMany({
      where: { userId, revokedAt: null, organization: { archivedAt: null } },
      include: { organization: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /**
   * Throws `AuthorizationError` — indistinguishable from "no such
   * organisation", so an id cannot be probed for existence by anyone outside
   * it.
   */
  async requireMembership(
    userId: string,
    organizationId: string,
    roles: readonly OrgRole[],
    db: Db = this.prisma,
  ): Promise<OrganizationMembership> {
    const membership = await db.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });

    if (!membership || membership.revokedAt != null) throw new AuthorizationError();
    if (!roles.includes(membership.role)) throw new AuthorizationError();

    return membership;
  }

  async findBySlugOrId(idOrSlug: string, db: Db = this.prisma) {
    const organization = await db.organization.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], archivedAt: null },
    });
    if (!organization) throw new NotFoundError();
    return organization;
  }

  /**
   * Drivers currently occupying a billable seat.
   *
   * `approved` and nothing else. The single definition is `occupiesSeat` in
   * src/domain/driver-status.ts, and this query is the one place it becomes
   * SQL — a second predicate somebody has to keep in step ends with an
   * operator billed for drivers they offboarded in March.
   *
   * A driver is offboarded rather than deleted, so this count and the seat
   * ledger can still be reconciled against an invoice raised three months ago.
   */
  async activeDriverCount(
    organizationId: string,
    db: Db = this.prisma,
  ): Promise<number> {
    return db.driver.count({ where: { organizationId, status: 'approved' } });
  }
}
