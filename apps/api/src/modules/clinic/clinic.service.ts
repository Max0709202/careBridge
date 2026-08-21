import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { RidesService } from '../care/rides.service';
import { AuthorizationError, ValidationError } from '../../common/errors';
import type { RequestContext } from '../../common/request-context';
import {
  assertCanDispatchReturn,
  canCheckIn,
  canDispatchReturn,
  returnIsOverdue,
  stageOf,
  waitingMinutes,
  type VisitState,
} from '../../domain/clinic-visit';
import type { RideStatus } from '../../domain/ride-status';
import type { ClinicDayDto, ClinicSiteDto, ExpectedArrivalDto } from './clinic.dto';

/**
 * Roles that may work the clinic portal.
 *
 * `member` is included, unlike the dispatch surfaces. The person who checks a
 * patient in is a receptionist, and requiring an admin role for the everyday
 * action would mean the portal is used by the wrong person or not at all.
 */
const PORTAL_ROLES = ['owner', 'admin', 'dispatcher', 'member'] as const;

/** Claiming a site grants sight of every appointment booked there. */
const CLAIM_ROLES = ['owner', 'admin'] as const;

const ARRIVAL_INCLUDE = {
  patient: { select: { preferredName: true } },
  clinic: { select: { id: true, name: true, timeZone: true } },
  rides: {
    select: {
      id: true,
      direction: true,
      status: true,
      etaMinutes: true,
      wheelchairRequired: true,
      driver: {
        select: {
          displayName: true,
          vehicle: { select: { make: true, model: true, color: true } },
        },
      },
    },
  },
} satisfies Prisma.AppointmentInclude;

type ArrivalRow = Prisma.AppointmentGetPayload<{ include: typeof ARRIVAL_INCLUDE }>;

/**
 * The clinic's side of a visit.
 *
 * Everything here is scoped by an organisation of kind `clinicNetwork`, and
 * every appointment is checked against a clinic that organisation has claimed.
 * The claim is the authorisation — there is no endpoint that takes an
 * appointment id as a capability.
 */
@Injectable()
export class ClinicPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
    private readonly rides: RidesService,
  ) {}

  // ─── sites ────────────────────────────────────────────────────────────────

  async sites(userId: string, organizationId: string): Promise<ClinicSiteDto[]> {
    await this.requireNetwork(userId, organizationId, PORTAL_ROLES);

    const rows = await this.prisma.clinic.findMany({
      where: { organizationId, archivedAt: null },
      include: { address: true },
      orderBy: { name: 'asc' },
    });

    return rows.map((clinic) => ({
      id: clinic.id,
      name: clinic.name,
      addressLine: `${clinic.address.line1}, ${clinic.address.city}`,
      timeZone: clinic.timeZone,
    }));
  }

  /**
   * Attaches a clinic record to this network.
   *
   * The record itself was almost certainly created by a **family** typing
   * where their relative's appointment is, which is why this is a claim rather
   * than a creation. It is also why it is audited and restricted to an admin:
   * claiming a site grants sight of every appointment anybody has ever booked
   * there.
   *
   * There is deliberately no self-service verification here — no emailed
   * link, no domain check. Claiming is done by CareBridge staff onboarding a
   * clinic network, and a self-service claim over a name typed by a stranger
   * would be a way to read other people's appointments.
   */
  async claim(
    userId: string,
    organizationId: string,
    clinicId: string,
    note: string | null,
    ctx: RequestContext,
  ): Promise<ClinicSiteDto[]> {
    await this.requireNetwork(userId, organizationId, CLAIM_ROLES);

    await this.prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.findUnique({ where: { id: clinicId } });
      if (!clinic || clinic.archivedAt) throw new AuthorizationError();

      if (clinic.organizationId && clinic.organizationId !== organizationId) {
        // Already somebody else's. Answered as a validation failure rather
        // than a 404, because the caller can see the clinic — it is in their
        // own patients' appointments — and a bare "not found" would be a lie
        // they could disprove.
        throw new ValidationError('That site is already claimed by another network.');
      }

      await tx.clinic.update({
        where: { id: clinicId },
        data: { organizationId },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'clinic.site_claimed',
          entityType: 'Clinic',
          entityId: clinicId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: note ? ['organizationId', 'note'] : ['organizationId'],
        },
        tx,
      );
    });

    return this.sites(userId, organizationId);
  }

  // ─── the day ──────────────────────────────────────────────────────────────

  /**
   * Everybody expected at this network's sites on one day.
   *
   * The date is resolved in the **clinic's** zone, not the server's and not
   * the caller's. A portal that showed yesterday's list to a west-coast clinic
   * every morning would be useless by nine o'clock.
   */
  async day(
    userId: string,
    organizationId: string,
    query: { on?: string; clinicId?: string },
    now: Date,
  ): Promise<ClinicDayDto> {
    await this.requireNetwork(userId, organizationId, PORTAL_ROLES);

    const clinics = await this.prisma.clinic.findMany({
      where: {
        organizationId,
        archivedAt: null,
        ...(query.clinicId ? { id: query.clinicId } : {}),
      },
      select: { id: true, timeZone: true },
    });
    if (clinics.length === 0) {
      return {
        date: query.on ?? isoDate(now),
        arrivals: [],
        waitingForReturn: 0,
        overdueReturns: 0,
      };
    }

    // Each site may be in a different zone, so the window is computed per
    // clinic and the results merged. Taking the first clinic's zone for all of
    // them would quietly shift a whole site's list by three hours.
    const windows = clinics.map((clinic) => {
      const zone = clinic.timeZone;
      const day = query.on
        ? DateTime.fromISO(query.on, { zone })
        : DateTime.fromJSDate(now, { zone });
      const start = day.startOf('day');
      return {
        clinicId: clinic.id,
        from: start.toJSDate(),
        to: start.plus({ days: 1 }).toJSDate(),
      };
    });

    const rows = await this.prisma.appointment.findMany({
      where: {
        OR: windows.map((window) => ({
          clinicId: window.clinicId,
          startsAt: { gte: window.from, lt: window.to },
        })),
      },
      include: ARRIVAL_INCLUDE,
      orderBy: { startsAt: 'asc' },
    });

    const arrivals = rows.map((row) => this.toArrival(row, now));

    return {
      date: query.on ?? isoDate(now),
      arrivals,
      waitingForReturn: arrivals.filter((a) => a.stage === 'readyForReturn').length,
      overdueReturns: arrivals.filter((a) => a.overdue).length,
    };
  }

  // ─── the two things a clinic knows ────────────────────────────────────────

  /**
   * The patient walked in.
   *
   * Recorded separately from the ride completing, and never inferred from it.
   * A completed ride says a car reached an address; this says somebody inside
   * the building saw them, and the gap between the two is an eighty-year-old
   * at the wrong entrance of a hospital.
   */
  async checkIn(
    userId: string,
    organizationId: string,
    appointmentId: string,
    ctx: RequestContext,
  ): Promise<ExpectedArrivalDto> {
    await this.requireNetwork(userId, organizationId, PORTAL_ROLES);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const appointment = await this.requireAppointmentOf(
        tx,
        organizationId,
        appointmentId,
      );

      if (!canCheckIn(visitStateOf(appointment))) {
        throw new ValidationError('That patient is already checked in.');
      }

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { checkedInAt: now, version: { increment: 1 } },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'clinic.patient_checked_in',
          entityType: 'Appointment',
          entityId: appointmentId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['checkedInAt'],
        },
        tx,
      );
    });

    return this.arrival(organizationId, appointmentId, now);
  }

  /**
   * The visit is over; send the car.
   *
   * This is what a `flexibleReturn` ride has been waiting for since it was
   * booked. Nobody knows when a cardiology follow-up will finish, which is why
   * the return leg is created without a time — and until this existed, nothing
   * could tell it the time had come.
   */
  async readyForReturn(
    userId: string,
    organizationId: string,
    appointmentId: string,
    ctx: RequestContext,
  ): Promise<ExpectedArrivalDto> {
    await this.requireNetwork(userId, organizationId, PORTAL_ROLES);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const appointment = await this.requireAppointmentOf(
        tx,
        organizationId,
        appointmentId,
      );
      const visit = visitStateOf(appointment);

      assertCanDispatchReturn(visit);

      const returnLeg = appointment.rides.find(
        (ride) => ride.direction === 'returnTrip',
      );
      if (!returnLeg) throw new ValidationError('No return journey was booked.');

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { readyForReturnAt: now, version: { increment: 1 } },
      });

      // Into the dispatch queue through the same state machine every other
      // caller uses. The clinic decides *when*; who drives is still the
      // operator's decision and the ride's own rules still apply.
      if (returnLeg.status === 'draft') {
        await this.rides.transition(tx, {
          rideId: returnLeg.id,
          to: 'requested',
          at: now,
          actor: 'Clinic',
          reason: 'The clinic said the visit was over',
        });
      }
      await this.rides.transition(tx, {
        rideId: returnLeg.id,
        to: 'awaitingAssignment',
        at: now,
        actor: 'Clinic',
        reason: 'The clinic said the visit was over',
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'clinic.return_requested',
          entityType: 'Appointment',
          entityId: appointmentId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['readyForReturnAt'],
        },
        tx,
      );
    });

    return this.arrival(organizationId, appointmentId, now);
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private async requireNetwork(
    userId: string,
    organizationId: string,
    roles: readonly string[],
  ): Promise<void> {
    await this.organizations.requireMembership(userId, organizationId, roles as never);

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { kind: true },
    });
    // A transport operator's dispatcher must not be able to read a clinic's
    // waiting room by pointing this endpoint at their own organisation id.
    if (organization?.kind !== 'clinicNetwork') throw new AuthorizationError();
  }

  private async requireAppointmentOf(
    tx: Prisma.TransactionClient,
    organizationId: string,
    appointmentId: string,
  ): Promise<ArrivalRow> {
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: ARRIVAL_INCLUDE,
    });
    if (!appointment) throw new AuthorizationError();

    const clinic = await tx.clinic.findUnique({
      where: { id: appointment.clinicId },
      select: { organizationId: true },
    });
    // The claim is the authorisation. An appointment at a site this network
    // has not claimed answers exactly as one that does not exist.
    if (clinic?.organizationId !== organizationId) throw new AuthorizationError();

    return appointment;
  }

  private async arrival(
    organizationId: string,
    appointmentId: string,
    now: Date,
  ): Promise<ExpectedArrivalDto> {
    const row = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: ARRIVAL_INCLUDE,
    });
    void organizationId;
    return this.toArrival(row, now);
  }

  private toArrival(row: ArrivalRow, now: Date): ExpectedArrivalDto {
    const visit = visitStateOf(row);
    const outbound = row.rides.find((ride) => ride.direction === 'outbound');
    const returnLeg = row.rides.find((ride) => ride.direction === 'returnTrip');

    // Whichever leg is live is the one the clinic wants a countdown for: the
    // outbound before the patient arrives, the return afterwards.
    const live = visit.checkedInAt ? (returnLeg ?? outbound) : (outbound ?? returnLeg);
    const dispatch = canDispatchReturn(visit);

    return {
      appointmentId: row.id,
      clinicId: row.clinic.id,
      clinicName: row.clinic.name,
      patientName: row.patient.preferredName,
      startsAt: row.startsAt.toISOString(),
      appointmentType: row.type,
      stage: stageOf(visit),
      outboundStatus: outbound?.status ?? null,
      returnStatus: returnLeg?.status ?? null,
      etaMinutes: live?.etaMinutes ?? null,
      driverName: live?.driver?.displayName ?? null,
      vehicleDescription: live?.driver
        ? `${live.driver.vehicle.color} ${live.driver.vehicle.make} ${live.driver.vehicle.model}`
        : null,
      wheelchairRequired: row.rides.some((ride) => ride.wheelchairRequired),
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
      readyForReturnAt: row.readyForReturnAt?.toISOString() ?? null,
      waitingMinutes: waitingMinutes(visit, now),
      overdue: returnIsOverdue(visit, now),
      canDispatchReturn: dispatch.ok,
      cannotDispatchReason: dispatch.reason ?? null,
    };
  }
}

function visitStateOf(row: ArrivalRow): VisitState {
  return {
    checkedInAt: row.checkedInAt,
    readyForReturnAt: row.readyForReturnAt,
    outboundStatus:
      (row.rides.find((ride) => ride.direction === 'outbound')?.status as RideStatus) ??
      null,
    returnStatus:
      (row.rides.find((ride) => ride.direction === 'returnTrip')
        ?.status as RideStatus) ?? null,
  };
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}
