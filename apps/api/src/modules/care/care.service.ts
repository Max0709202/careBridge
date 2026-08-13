import { Injectable } from '@nestjs/common';
import type { Prisma, PatientAccess, NotificationKind } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationError, NotFoundError } from '../../common/errors';
import { Money } from '../../domain/money';
import type { FamilyPermission } from '../../domain/permissions';
import type { PricingRule } from '../../domain/pricing';
import type { CareStateDto } from './care.dto';
import {
  APPOINTMENT_INCLUDE,
  CLINIC_INCLUDE,
  PATIENT_INCLUDE,
  RIDE_INCLUDE,
  toAccessDto,
  toAppointmentDto,
  toClinicDto,
  toNotificationDto,
  toPatientDto,
  toRideDto,
  toUserDto,
} from './care.mapper';

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class CareService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything one signed-in user may see, as one value.
   *
   * The `in: patientIds` on every query is the authorisation boundary, applied
   * at the point of reading rather than filtered afterwards: data the caller
   * has no grant for never enters the result set, so it cannot be leaked by a
   * mapper that forgets to check. A revoked grant therefore closes every
   * surface at once — the patient, their appointments, their rides and their
   * live position all disappear on the next request.
   */
  async snapshot(userId: string): Promise<CareStateDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError();

    const grants = await this.prisma.patientAccess.findMany({
      where: {
        userId,
        revokedAt: null,
        // A grant that cannot view the profile cannot see the person at all.
        // `viewProfile` is the floor every other permission stands on.
        permissions: { has: 'viewProfile' },
      },
    });

    const patientIds = grants.map((g) => g.patientId);

    const [patients, clinics, appointments, rides, notifications] = await Promise.all([
      this.prisma.patient.findMany({
        where: { id: { in: patientIds } },
        include: PATIENT_INCLUDE,
        orderBy: { preferredName: 'asc' },
      }),
      this.prisma.clinic.findMany({
        where: { archivedAt: null },
        include: CLINIC_INCLUDE,
        orderBy: { name: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: { patientId: { in: patientIds } },
        include: APPOINTMENT_INCLUDE,
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.ride.findMany({
        where: { patientId: { in: patientIds } },
        include: RIDE_INCLUDE,
        orderBy: { scheduledPickupAt: 'asc' },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const access: CareStateDto['access'] = {};
    for (const grant of grants) {
      access[grant.patientId] = toAccessDto(grant);
    }

    // A stored selection whose grant has since been revoked must not survive:
    // it would point the whole app at a patient it can no longer load.
    const selectedPatientId =
      user.selectedPatientId && patientIds.includes(user.selectedPatientId)
        ? user.selectedPatientId
        : (patientIds[0] ?? null);

    return {
      user: toUserDto(user),
      patients: patients.map(toPatientDto),
      access,
      clinics: clinics.map(toClinicDto),
      appointments: appointments.map(toAppointmentDto),
      rides: rides.map(toRideDto),
      notifications: notifications.map(toNotificationDto),
      selectedPatientId,
      simplifiedMode: user.simplifiedMode,
    };
  }

  // ─── authorisation policy ─────────────────────────────────────────────────

  /**
   * The single implementation. Every patient-scoped operation calls this — no
   * module re-derives it, because two implementations of an authorisation rule
   * eventually disagree and the disagreement is a data leak.
   *
   * Throws `AuthorizationError`, which is deliberately indistinguishable from
   * `NotFoundError` to the caller: "no such patient" and "not your patient"
   * must not be tellable apart, or the error becomes a probe.
   */
  async requirePermission(
    userId: string,
    patientId: string,
    permission: FamilyPermission,
    db: Db = this.prisma,
  ): Promise<PatientAccess> {
    const grant = await db.patientAccess.findUnique({
      where: { userId_patientId: { userId, patientId } },
    });

    if (!grant || grant.revokedAt != null) throw new AuthorizationError();
    if (!grant.permissions.includes(permission)) throw new AuthorizationError();

    return grant;
  }

  /**
   * Resolves a ride to the patient it belongs to, then checks the grant.
   *
   * Authorisation is never asked of a ride id directly — it resolves *up* the
   * graph: ride → patient → grant. A ride id is not a capability.
   */
  async requireRidePermission(
    userId: string,
    rideId: string,
    permission: FamilyPermission,
    db: Db = this.prisma,
  ): Promise<{ patientId: string }> {
    const ride = await db.ride.findUnique({
      where: { id: rideId },
      select: { patientId: true },
    });
    if (!ride) throw new NotFoundError();

    await this.requirePermission(userId, ride.patientId, permission, db);
    return ride;
  }

  async requireAppointmentPermission(
    userId: string,
    appointmentId: string,
    permission: FamilyPermission,
    db: Db = this.prisma,
  ): Promise<{ patientId: string }> {
    const appointment = await db.appointment.findUnique({
      where: { id: appointmentId },
      select: { patientId: true },
    });
    if (!appointment) throw new NotFoundError();

    await this.requirePermission(userId, appointment.patientId, permission, db);
    return appointment;
  }

  // ─── notifications ────────────────────────────────────────────────────────

  /**
   * Notifies everyone who can see this patient, not just whoever acted.
   *
   * A daughter booking a ride and a son watching for it are the normal case —
   * telling only the person who tapped the button would leave the rest of the
   * family in exactly the silence this product exists to remove.
   *
   * Bodies carry no patient name, clinic name, address or time. A phone on a
   * kitchen table is readable by whoever is in the room, and for an older adult
   * that may include the person they most need privacy from.
   */
  async notifyPatientCircle(
    db: Db,
    patientId: string,
    notification: {
      kind: NotificationKind;
      title: string;
      body: string;
      rideId?: string | null;
      appointmentId?: string | null;
    },
  ): Promise<void> {
    const grants = await db.patientAccess.findMany({
      where: { patientId, revokedAt: null, permissions: { has: 'viewProfile' } },
      select: { userId: true },
    });

    if (grants.length === 0) return;

    await db.notification.createMany({
      data: grants.map((g) => ({
        userId: g.userId,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        rideId: notification.rideId ?? null,
        appointmentId: notification.appointmentId ?? null,
      })),
    });
  }

  // ─── pricing ──────────────────────────────────────────────────────────────

  /**
   * The rule in force. Loaded from the database, never hard-coded — so a
   * historical charge can always be explained by the versioned rule that
   * produced it.
   */
  async activePricingRule(db: Db = this.prisma): Promise<PricingRule> {
    const rule = await db.pricingRule.findFirst({
      where: { active: true, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!rule) {
      // Seeded by the migration's seed step. Its absence means the database was
      // not seeded, which is an operator error worth failing loudly on rather
      // than papering over with a made-up price.
      throw new NotFoundError();
    }

    return {
      version: rule.version,
      baseFare: new Money(rule.baseFareCents),
      perMile: new Money(rule.perMileCents),
      perMinute: new Money(rule.perMinuteCents),
      minimumFare: new Money(rule.minimumFareCents),
      wheelchairSurcharge: new Money(rule.wheelchairSurchargeCents),
      assistanceSurcharge: new Money(rule.assistanceSurchargeCents),
      effectiveFrom: rule.effectiveFrom,
    };
  }
}
