import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import {
  assertAppointmentTransition,
  canTransitionAppointment,
  isTerminalAppointmentStatus,
  type AppointmentStatus,
} from '../../domain/appointment-status';
import type { RequestContext } from '../../common/request-context';
import { CareService } from './care.service';
import type {
  CancelAppointmentDto,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from './dto/appointment.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly care: CareService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    dto: CreateAppointmentDto,
    ctx: RequestContext,
  ): Promise<string> {
    await this.care.requirePermission(userId, dto.patientId, 'scheduleAppointments');

    const startsAt = new Date(dto.startsAt);
    const now = new Date();
    if (startsAt.getTime() < now.getTime()) {
      throw new ValidationError(
        'Choose a date and time in the future.',
        'startsAt',
      );
    }

    const clinic = await this.prisma.clinic.findFirst({
      where: { id: dto.clinicId, archivedAt: null },
      select: { id: true },
    });
    if (!clinic) throw new NotFoundError();

    const actor = await this.actorName(userId);

    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          patientId: dto.patientId,
          clinicId: dto.clinicId,
          startsAt,
          expectedDurationMinutes: dto.expectedDurationMinutes,
          type: dto.type,
          status: 'scheduled',
          coordinationNotes: dto.coordinationNotes?.trim() || null,
          transportRequired: dto.transportRequired ?? false,
          history: {
            create: {
              at: now,
              fromStatus: 'draft',
              toStatus: 'scheduled',
              actor,
            },
          },
        },
      });

      await this.care.notifyPatientCircle(tx, dto.patientId, {
        kind: 'appointmentCreated',
        title: 'Appointment added',
        body: 'An appointment has been added to the calendar.',
        appointmentId: appointment.id,
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'appointment.create',
          entityType: 'Appointment',
          entityId: appointment.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return appointment.id;
    });
  }

  async reschedule(
    userId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
    ctx: RequestContext,
  ): Promise<void> {
    await this.care.requireAppointmentPermission(
      userId,
      appointmentId,
      'scheduleAppointments',
    );

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!appointment) throw new NotFoundError();

    if (isTerminalAppointmentStatus(appointment.status)) {
      throw new ValidationError('That appointment can no longer be changed.');
    }

    const startsAt = new Date(dto.startsAt);
    const now = new Date();
    if (startsAt.getTime() < now.getTime()) {
      throw new ValidationError(
        'Choose a date and time in the future.',
        'startsAt',
      );
    }

    const actor = await this.actorName(userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          startsAt,
          version: { increment: 1 },
          history: {
            create: {
              at: now,
              // The status is unchanged — a reschedule moves the time, not the
              // lifecycle — but it still belongs in the history, because "when
              // did this move, and who moved it" is exactly what a family asks
              // when a car turns up at the old time.
              fromStatus: appointment.status,
              toStatus: appointment.status,
              actor,
              reason: 'Rescheduled',
            },
          },
        },
      });

      await this.care.notifyPatientCircle(tx, appointment.patientId, {
        kind: 'appointmentChanged',
        title: 'Appointment updated',
        body: 'An appointment has changed. Open CareBridge to see the details.',
        appointmentId,
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'appointment.reschedule',
          entityType: 'Appointment',
          entityId: appointmentId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['startsAt'],
        },
        tx,
      );
    });
  }

  async cancel(
    userId: string,
    appointmentId: string,
    dto: CancelAppointmentDto,
    ctx: RequestContext,
    cancelRides: (tx: Tx, rideId: string, reason: string) => Promise<void>,
  ): Promise<void> {
    await this.care.requireAppointmentPermission(
      userId,
      appointmentId,
      'scheduleAppointments',
    );

    const actor = await this.actorName(userId);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, {
        appointmentId,
        to: 'canceled',
        at: now,
        actor,
        reason: dto.reason ?? null,
        notify: true,
      });

      // Cancelling the appointment must cancel the rides booked for it. Leaving
      // a car to arrive for an appointment that is not happening is the kind of
      // failure that ends a pilot.
      //
      // A leg that has already delivered the passenger is the exception: there
      // is nothing left to call off and the state machine rightly forbids it.
      // It is skipped rather than allowed to throw — otherwise the family loses
      // the ability to cancel the appointment at all for the minutes between
      // arrival and completion, which is precisely when they are most likely
      // to try.
      const rides = await tx.ride.findMany({
        where: {
          appointmentId,
          status: { notIn: ['completed', 'canceled', 'noShow'] },
        },
        select: { id: true },
      });

      for (const ride of rides) {
        await cancelRides(tx, ride.id, 'Appointment canceled');
      }

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'appointment.cancel',
          entityType: 'Appointment',
          entityId: appointmentId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /**
   * The one place an appointment status changes. Every caller — including the
   * ride module, which drives appointment progress from ride progress — funnels
   * through here so the machine is enforced and history is appended.
   */
  async transition(
    tx: Tx,
    input: {
      appointmentId: string;
      to: AppointmentStatus;
      at: Date;
      actor: string;
      reason?: string | null;
      notify?: boolean;
    },
  ): Promise<void> {
    const appointment = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
    });
    if (!appointment) throw new NotFoundError();

    assertAppointmentTransition(appointment.status, input.to);

    await tx.appointment.update({
      where: { id: input.appointmentId },
      data: {
        status: input.to,
        version: { increment: 1 },
        history: {
          create: {
            at: input.at,
            fromStatus: appointment.status,
            toStatus: input.to,
            actor: input.actor,
            reason: input.reason ?? null,
          },
        },
      },
    });

    if (input.notify && input.to === 'canceled') {
      await this.care.notifyPatientCircle(tx, appointment.patientId, {
        kind: 'appointmentCanceled',
        title: 'Appointment canceled',
        body: 'An appointment has been canceled.',
        appointmentId: input.appointmentId,
      });
    }
  }

  /**
   * Moves an appointment only if the machine permits it.
   *
   * Used where a ride implies an appointment status that may already have been
   * reached or overtaken — an implied transition that is not currently legal is
   * simply not the appointment's next step, which is information, not an error.
   */
  async transitionIfLegal(
    tx: Tx,
    input: {
      appointmentId: string;
      to: AppointmentStatus;
      at: Date;
      actor: string;
    },
  ): Promise<void> {
    const appointment = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
      select: { status: true },
    });
    if (!appointment) return;
    if (!canTransitionAppointment(appointment.status, input.to)) return;

    await this.transition(tx, { ...input, notify: false });
  }

  async actorName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    return user?.fullName ?? 'You';
  }
}
