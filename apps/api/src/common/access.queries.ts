import { Global, Injectable, Module } from '@nestjs/common';

import { PrismaService } from '../infrastructure/prisma/prisma.service';

/** The org roles that dispatch. `member` is deliberately not one of them. */
export const DISPATCH_ROLES = ['owner', 'admin', 'dispatcher'] as const;

/**
 * The two relationships that decide who may see a patient's movements and who
 * may talk about them: a family grant and a dispatching membership.
 *
 * Shared by live tracking and messaging, and that is the reason it exists
 * rather than two private copies — the two surfaces answer the same question
 * ("is this person in this patient's circle, or at this operator's desk?")
 * and a fix to one that the other did not get would be a leak on the other.
 *
 * Revocation is in every query rather than checked afterwards. A grant read
 * without it is the classic bug in this shape: removing somebody's access
 * appears to work everywhere it is displayed and changes nothing about what
 * they can still receive.
 */
@Injectable()
export class AccessQueries {
  constructor(private readonly prisma: PrismaService) {}

  /** An active grant carrying `viewProfile` on the patient. */
  async hasFamilyAccess(userId: string, patientId: string): Promise<boolean> {
    const grant = await this.prisma.patientAccess.findFirst({
      where: {
        userId,
        patientId,
        revokedAt: null,
        permissions: { has: 'viewProfile' },
      },
      select: { id: true },
    });
    return grant !== null;
  }

  /** Every patient the user holds an active `viewProfile` grant on. */
  async familyPatientIds(userId: string): Promise<Set<string>> {
    const grants = await this.prisma.patientAccess.findMany({
      where: { userId, revokedAt: null, permissions: { has: 'viewProfile' } },
      select: { patientId: true },
    });
    return new Set(grants.map((g) => g.patientId));
  }

  /** Users with an active `viewProfile` grant on the patient — its family circle. */
  async familyUserIds(patientId: string): Promise<string[]> {
    const grants = await this.prisma.patientAccess.findMany({
      where: { patientId, revokedAt: null, permissions: { has: 'viewProfile' } },
      select: { userId: true },
    });
    return grants.map((g) => g.userId);
  }

  /** A live membership at the operator, in a role that dispatches. */
  async dispatchesFor(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        userId,
        organizationId,
        revokedAt: null,
        role: { in: [...DISPATCH_ROLES] },
      },
      select: { id: true },
    });
    return membership !== null;
  }

  /** Every operator the user dispatches for. */
  async dispatchOrganizationIds(userId: string): Promise<Set<string>> {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId, revokedAt: null, role: { in: [...DISPATCH_ROLES] } },
      select: { organizationId: true },
    });
    return new Set(memberships.map((m) => m.organizationId));
  }

  /** Users who dispatch for the operator — its desk. */
  async dispatcherUserIds(organizationId: string): Promise<string[]> {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { organizationId, revokedAt: null, role: { in: [...DISPATCH_ROLES] } },
      select: { userId: true },
    });
    return memberships.map((m) => m.userId);
  }
}

@Global()
@Module({
  providers: [AccessQueries],
  exports: [AccessQueries],
})
export class AccessQueriesModule {}
