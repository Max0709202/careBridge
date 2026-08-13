import { Injectable } from '@nestjs/common';
import type { Prisma, NotificationKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { appointmentStatusForRide } from '../../domain/appointment-status';
import { distanceMiles, estimateDriveMinutes } from '../../domain/geo';
import { estimateFare } from '../../domain/pricing';
import {
  allowsLocationSharing,
  assertRideTransition,
  canTransitionRide,
  isTerminalRideStatus,
  type RideStatus,
} from '../../domain/ride-status';
import { checkPositionFreshness } from '../../domain/tracking';
import type { RequestContext } from '../../common/request-context';
import { AppointmentsService } from './appointments.service';
import { CareService } from './care.service';
import type {
  CancelRideDto,
  ReportLocationDto,
  RequestTransportDto,
  SetDelayDto,
} from './dto/ride.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class RidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly care: CareService,
    private readonly appointments: AppointmentsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates the ride(s) for an appointment.
   *
   * A round trip produces **two rides** sharing a `roundTripGroupId`. The
   * return leg is marked `flexibleReturn` because nobody knows when a
   * cardiology follow-up will actually finish; it is dispatched when the family
   * says the visit is over, not at a time guessed days earlier.
   */
  async requestTransport(
    userId: string,
    dto: RequestTransportDto,
    ctx: RequestContext,
  ): Promise<string> {
    const { patientId } = await this.care.requireAppointmentPermission(
      userId,
      dto.appointmentId,
      'requestTransport',
    );

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
      include: { clinic: { include: { address: true } } },
    });
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: { homeAddress: true },
    });
    if (!appointment || !patient) throw new NotFoundError();

    const pickupAt = new Date(dto.pickupAt);
    if (pickupAt.getTime() > appointment.startsAt.getTime()) {
      throw new ValidationError(
        'Pickup must be before the appointment starts.',
        'pickupAt',
      );
    }

    const active = await this.prisma.ride.count({
      where: {
        appointmentId: dto.appointmentId,
        status: { notIn: ['completed', 'canceled', 'noShow'] },
      },
    });
    if (active > 0) {
      throw new ValidationError(
        'Transportation is already booked for this appointment.',
      );
    }

    const wheelchairRequired = patient.mobilityNeeds.includes('wheelchair');
    const assistanceRequired =
      patient.mobilityNeeds.includes('escortToDoor') ||
      patient.mobilityNeeds.includes('transferAssistance');

    const rule = await this.care.activePricingRule();
    const home = patient.homeAddress;
    const clinicAddress = appointment.clinic.address;

    // Without coordinates we cannot estimate honestly, so the minimum fare
    // stands rather than a number invented to look precise.
    const miles =
      home.latitude != null &&
      home.longitude != null &&
      clinicAddress.latitude != null &&
      clinicAddress.longitude != null
        ? Number(
            distanceMiles(
              { latitude: home.latitude, longitude: home.longitude },
              {
                latitude: clinicAddress.latitude,
                longitude: clinicAddress.longitude,
              },
            ).toFixed(1),
          )
        : 0;

    const estimate = estimateFare({
      rule,
      distanceMiles: miles,
      durationMinutes: estimateDriveMinutes(miles),
      wheelchairAccessRequired: wheelchairRequired,
      assistanceRequired,
    });

    const priceColumns = {
      priceRuleVersion: estimate.ruleVersion,
      distanceMiles: estimate.distanceMiles,
      durationMinutes: estimate.durationMinutes,
      baseCents: estimate.base.cents,
      distanceChargeCents: estimate.distanceCharge.cents,
      timeChargeCents: estimate.timeCharge.cents,
      totalCents: estimate.total.cents,
      minimumApplied: estimate.minimumApplied,
      surcharges: {
        create: estimate.surcharges.map((s, index) => ({
          label: s.label,
          amountCents: s.amount.cents,
          position: index,
        })),
      },
    };

    const groupId = dto.roundTrip ? randomUUID() : null;
    const now = new Date();
    const actor = await this.appointments.actorName(userId);
    const notes = dto.notesForDriver?.trim() || null;

    const outboundId = await this.prisma.$transaction(async (tx) => {
      // Addresses are **snapshotted**, not referenced: a completed ride must
      // still say where the car actually went after the patient moves house.
      // Each leg gets its own pair, so editing one can never rewrite the other.
      const snapshot = () => snapshotAddresses(tx, home, clinicAddress);
      const outboundAddresses = await snapshot();

      const outbound = await tx.ride.create({
        data: {
          patientId,
          appointmentId: dto.appointmentId,
          roundTripGroupId: groupId,
          direction: 'outbound',
          pickupAddressId: outboundAddresses.from,
          destinationAddressId: outboundAddresses.to,
          scheduledPickupAt: pickupAt,
          status: 'requested',
          wheelchairRequired,
          assistanceRequired,
          notesForDriver: notes,
          ...priceColumns,
          history: {
            create: {
              at: now,
              fromStatus: 'draft',
              toStatus: 'requested',
              actor,
            },
          },
          events: { create: { at: now, title: 'Ride requested' } },
        },
      });

      if (dto.roundTrip) {
        const endsAt = new Date(
          appointment.startsAt.getTime() + appointment.expectedDurationMinutes * 60_000,
        );
        const returnAddresses = await snapshot();

        await tx.ride.create({
          data: {
            patientId,
            appointmentId: dto.appointmentId,
            roundTripGroupId: groupId,
            direction: 'returnTrip',
            // Reversed: the return leg collects from the clinic.
            pickupAddressId: returnAddresses.to,
            destinationAddressId: returnAddresses.from,
            scheduledPickupAt: endsAt,
            flexibleReturn: true,
            status: 'requested',
            wheelchairRequired,
            assistanceRequired,
            notesForDriver: notes,
            ...priceColumns,
            history: {
              create: {
                at: now,
                fromStatus: 'draft',
                toStatus: 'requested',
                actor,
              },
            },
            events: {
              create: {
                at: now,
                title: 'Return ride requested',
                detail:
                  'Pickup time is flexible — we will send a car when the visit ends.',
              },
            },
          },
        });
      }

      await this.appointments.transitionIfLegal(tx, {
        appointmentId: dto.appointmentId,
        to: 'transportationScheduled',
        at: now,
        actor: 'CareBridge',
      });

      await this.care.notifyPatientCircle(tx, patientId, {
        kind: 'rideRequested',
        title: dto.roundTrip ? 'Round trip requested' : 'Ride requested',
        body: 'We are finding a driver. You will be notified when one is assigned.',
        rideId: outbound.id,
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'ride.request',
          entityType: 'Ride',
          entityId: outbound.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return outbound.id;
    });

    return outboundId;
  }

  async cancel(
    userId: string,
    rideId: string,
    dto: CancelRideDto,
    ctx: RequestContext,
  ): Promise<void> {
    await this.care.requireRidePermission(userId, rideId, 'requestTransport');
    const actor = await this.appointments.actorName(userId);

    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, {
        rideId,
        to: 'canceled',
        at: new Date(),
        actor,
        reason: dto.reason,
      });
      await tx.ride.update({
        where: { id: rideId },
        data: { cancellationReason: dto.reason },
      });
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'ride.cancel',
          entityType: 'Ride',
          entityId: rideId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /** Used by appointment cancellation, which cancels the rides it owns. */
  async cancelWithinTransaction(tx: Tx, rideId: string, reason: string): Promise<void> {
    const ride = await tx.ride.findUnique({
      where: { id: rideId },
      select: { status: true },
    });
    if (!ride) return;
    if (!canTransitionRide(ride.status, 'canceled')) return;

    await this.transition(tx, {
      rideId,
      to: 'canceled',
      at: new Date(),
      actor: 'CareBridge',
      reason,
    });
    await tx.ride.update({
      where: { id: rideId },
      data: { cancellationReason: reason },
    });
  }

  /**
   * Moves a ride, enforcing the state machine. The one place a ride status
   * changes — the preview trip runner and the family's cancel button both come
   * through here, and neither has a privileged path.
   */
  async transition(
    tx: Tx,
    input: {
      rideId: string;
      to: RideStatus;
      at: Date;
      actor: string;
      reason?: string | null;
      driverId?: string | null;
    },
  ): Promise<void> {
    const ride = await tx.ride.findUnique({
      where: { id: input.rideId },
      include: { driver: { include: { vehicle: true } } },
    });
    if (!ride) throw new NotFoundError();

    assertRideTransition(ride.status, input.to);

    const driverId = input.driverId ?? ride.driverId;
    const driver = input.driverId
      ? await tx.driver.findUnique({
          where: { id: input.driverId },
          include: { vehicle: true },
        })
      : ride.driver;

    const event = eventFor(
      input.to,
      driver
        ? `${driver.displayName} — ${driver.vehicle.color} ${driver.vehicle.make} ${driver.vehicle.model}`
        : null,
    );

    // Tracking stops the moment a ride leaves a state where sharing is legal,
    // and the last known position and ETA go with it. Nothing should be able to
    // render a position for a finished ride.
    const clearsTracking = !allowsLocationSharing(input.to);
    const terminal = isTerminalRideStatus(input.to);

    await tx.ride.update({
      where: { id: input.rideId },
      data: {
        status: input.to,
        driverId,
        isDelayed: terminal ? false : ride.isDelayed,
        delayReason: terminal ? null : ride.delayReason,
        version: { increment: 1 },
        ...(clearsTracking
          ? {
              lastLatitude: null,
              lastLongitude: null,
              lastAccuracyMeters: null,
              lastCapturedAt: null,
              etaMinutes: null,
            }
          : {}),
        ...(terminal ? { simulationActive: false, simulationElapsedSeconds: 0 } : {}),
        history: {
          create: {
            at: input.at,
            fromStatus: ride.status,
            toStatus: input.to,
            actor: input.actor,
            reason: input.reason ?? null,
          },
        },
        ...(event ? { events: { create: event } } : {}),
      },
    });

    // Ride progress drives appointment progress: the family should not have to
    // hold two separate states in their head.
    const implied = appointmentStatusForRide(input.to);
    if (implied && ride.appointmentId) {
      await this.appointments.transitionIfLegal(tx, {
        appointmentId: ride.appointmentId,
        to: implied,
        at: input.at,
        actor: 'CareBridge',
      });
    }

    const notification = notificationFor(input.to);
    if (notification) {
      await this.care.notifyPatientCircle(tx, ride.patientId, {
        ...notification,
        rideId: input.rideId,
      });
    }
  }

  /**
   * Raises or clears a delay.
   *
   * Delay is a flag rather than a status: a driver stuck in traffic on the way
   * to pickup is still `driverEnRoute`, and turning that into a status would
   * lose the state it has to return to.
   */
  async setDelay(
    userId: string,
    rideId: string,
    dto: SetDelayDto,
    ctx: RequestContext,
  ): Promise<void> {
    await this.care.requireRidePermission(userId, rideId, 'requestTransport');

    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundError();
    if (isTerminalRideStatus(ride.status)) {
      throw new ValidationError('That ride has already finished.');
    }

    const now = new Date();
    const reason = dto.delayed ? dto.reason?.trim() || null : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.ride.update({
        where: { id: rideId },
        data: {
          isDelayed: dto.delayed,
          delayReason: reason,
          events: {
            create: {
              at: now,
              title: dto.delayed ? 'Running late' : 'Back on schedule',
              detail: reason,
              isException: dto.delayed,
            },
          },
        },
      });

      if (dto.delayed) {
        await this.care.notifyPatientCircle(tx, ride.patientId, {
          kind: 'rideDelayed',
          title: 'Ride running late',
          body: 'A ride is running behind schedule. Open CareBridge for the latest.',
          rideId,
        });
      }

      await this.audit.record(
        {
          actorUserId: userId,
          action: dto.delayed ? 'ride.delay.raise' : 'ride.delay.clear',
          entityType: 'Ride',
          entityId: rideId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /**
   * Records a position report.
   *
   * Two checks, both server-side. In production a third joins them — "is this
   * device the driver currently assigned to this ride" — which only the server
   * can answer, and which is why this endpoint exists here rather than as a
   * client-side write.
   *
   * The timestamp check matters more than it looks. Every freshness label in
   * the app ages a position against `capturedAt`, so a point stamped in the
   * future reads as "updated just now" indefinitely — a stale car rendered as a
   * moving one, the one failure mode this product cannot have.
   */
  async reportLocation(
    tx: Tx,
    rideId: string,
    dto: ReportLocationDto,
    now: Date,
  ): Promise<void> {
    const ride = await tx.ride.findUnique({
      where: { id: rideId },
      select: { status: true },
    });
    if (!ride) throw new NotFoundError();

    if (!allowsLocationSharing(ride.status)) {
      throw new ValidationError(
        'That ride is not in a state where location may be shared.',
      );
    }

    const capturedAt = new Date(dto.capturedAt);
    const freshness = checkPositionFreshness(capturedAt, now);

    if (!freshness.ok) {
      throw new ValidationError(
        freshness.reason === 'future'
          ? 'That position reading is stamped in the future and cannot be trusted.'
          : 'That position reading is too old to show as a current location.',
        'capturedAt',
      );
    }

    const accuracyMeters = dto.accuracyMeters ?? 12;

    await tx.ride.update({
      where: { id: rideId },
      data: {
        lastLatitude: dto.latitude,
        lastLongitude: dto.longitude,
        lastAccuracyMeters: accuracyMeters,
        lastCapturedAt: capturedAt,
        etaMinutes: dto.etaMinutes ?? null,
        // Sampled history, for dispute resolution. Thirty-day retention,
        // enforced by the retention job.
        locationSamples: {
          create: {
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracyMeters,
            capturedAt,
            receivedAt: now,
          },
        },
      },
    });
  }
}

interface AddressFields {
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  accessNotes: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Copies a pair of live addresses into fresh rows owned by one ride leg. */
async function snapshotAddresses(
  tx: Tx,
  from: AddressFields,
  to: AddressFields,
): Promise<{ from: string; to: string }> {
  const [fromRow, toRow] = await Promise.all([
    tx.address.create({ data: copyOf(from) }),
    tx.address.create({ data: copyOf(to) }),
  ]);
  return { from: fromRow.id, to: toRow.id };
}

function copyOf(address: AddressFields): Prisma.AddressCreateInput {
  return {
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    accessNotes: address.accessNotes,
    latitude: address.latitude,
    longitude: address.longitude,
  };
}

function eventFor(
  status: RideStatus,
  driverDescription: string | null,
): { at: Date; title: string; detail?: string | null; isException?: boolean } | null {
  const at = new Date();
  switch (status) {
    case 'awaitingAssignment':
      return { at, title: 'Looking for a driver' };
    case 'assigned':
      return { at, title: 'Driver assigned', detail: driverDescription };
    case 'driverAccepted':
      return { at, title: 'Driver confirmed the trip' };
    case 'driverEnRoute':
      return { at, title: 'Driver set off for pickup' };
    case 'driverArrived':
      return { at, title: 'Driver arrived at pickup' };
    case 'passengerOnboard':
      return { at, title: 'Picked up safely' };
    case 'inProgress':
      return { at, title: 'On the way' };
    case 'arrivedAtDestination':
      return { at, title: 'Arrived at the clinic' };
    case 'completed':
      return { at, title: 'Ride completed' };
    case 'canceled':
      return { at, title: 'Ride canceled', isException: true };
    case 'noShow':
      return {
        at,
        title: 'Nobody came to the door',
        detail: 'The driver waited and could not make contact.',
        isException: true,
      };
    case 'reassignmentRequired':
      return { at, title: 'Finding a replacement driver', isException: true };
    default:
      return null;
  }
}

/**
 * Notification bodies. No patient name, clinic name, address or time appears in
 * any of them — see the note on the Notification model.
 */
function notificationFor(
  status: RideStatus,
): { kind: NotificationKind; title: string; body: string } | null {
  switch (status) {
    case 'assigned':
      return {
        kind: 'driverAssigned',
        title: 'Driver assigned',
        body: 'A driver has been assigned. Open CareBridge to see the details.',
      };
    case 'driverEnRoute':
      return {
        kind: 'driverEnRoute',
        title: 'Driver on the way',
        body: 'The driver has set off. You can follow the trip in CareBridge.',
      };
    case 'driverArrived':
      return {
        kind: 'driverArrived',
        title: 'Driver has arrived',
        body: 'The driver is at the pickup address.',
      };
    case 'passengerOnboard':
      return {
        kind: 'patientPickedUp',
        title: 'Picked up safely',
        body: 'The trip to the appointment has started.',
      };
    case 'arrivedAtDestination':
      return {
        kind: 'patientArrived',
        title: 'Arrived at the clinic',
        body: 'The trip is complete and the passenger is at the destination.',
      };
    case 'completed':
      return {
        kind: 'rideCompleted',
        title: 'Ride completed',
        body: 'A ride has finished. A receipt is available in CareBridge.',
      };
    case 'canceled':
      return {
        kind: 'rideCanceled',
        title: 'Ride canceled',
        body: 'A ride has been canceled.',
      };
    case 'noShow':
      return {
        kind: 'rideDelayed',
        title: 'Pickup could not be completed',
        body: 'The driver could not make contact. Open CareBridge to review.',
      };
    default:
      return null;
  }
}
