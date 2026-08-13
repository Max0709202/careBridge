import { type Prisma } from '@prisma/client';
import type {
  Address,
  EmergencyContact,
  Notification,
  PatientAccess,
  User,
} from '@prisma/client';

import type {
  AddressDto,
  AppUserDto,
  AppointmentDto,
  ClinicDto,
  NotificationDto,
  PatientAccessDto,
  PatientDto,
  RideDto,
  StatusChangeDto,
} from './care.dto';

/**
 * The relations a ride must be loaded with to be mapped. Declared once so a
 * query and its mapper cannot drift apart — a missing include would otherwise
 * surface as `undefined` deep inside a response the client silently mis-reads.
 */
export const RIDE_INCLUDE = {
  pickup: true,
  destination: true,
  driver: { include: { vehicle: true } },
  surcharges: { orderBy: { position: 'asc' } },
  events: { orderBy: { at: 'asc' } },
  history: { orderBy: { at: 'asc' } },
} satisfies Prisma.RideInclude;

export type RideWithRelations = Prisma.RideGetPayload<{
  include: typeof RIDE_INCLUDE;
}>;

export const PATIENT_INCLUDE = {
  homeAddress: true,
  emergencyContacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
} satisfies Prisma.PatientInclude;

export type PatientWithRelations = Prisma.PatientGetPayload<{
  include: typeof PATIENT_INCLUDE;
}>;

export const APPOINTMENT_INCLUDE = {
  history: { orderBy: { at: 'asc' } },
} satisfies Prisma.AppointmentInclude;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: typeof APPOINTMENT_INCLUDE;
}>;

export const CLINIC_INCLUDE = { address: true } satisfies Prisma.ClinicInclude;

export type ClinicWithRelations = Prisma.ClinicGetPayload<{
  include: typeof CLINIC_INCLUDE;
}>;

// ─── mappers ─────────────────────────────────────────────────────────────────

export function toAddressDto(address: Address): AddressDto {
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

export function toUserDto(user: User): AppUserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    timeZone: user.timeZone,
  };
}

export function toPatientDto(patient: PatientWithRelations): PatientDto {
  return {
    id: patient.id,
    preferredName: patient.preferredName,
    legalName: patient.legalName,
    phone: patient.phone,
    homeAddress: toAddressDto(patient.homeAddress),
    ageBand: patient.ageBand,
    preferredLanguage: patient.preferredLanguage,
    mobilityNeeds: patient.mobilityNeeds,
    mobilityNotes: patient.mobilityNotes,
    emergencyContacts: patient.emergencyContacts.map(toEmergencyContactDto),
    preferredClinicId: patient.preferredClinicId,
    archivedAt: iso(patient.archivedAt),
  };
}

function toEmergencyContactDto(contact: EmergencyContact) {
  return {
    id: contact.id,
    name: contact.name,
    relationship: contact.relationship,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
  };
}

export function toAccessDto(access: PatientAccess): PatientAccessDto {
  return {
    userId: access.userId,
    patientId: access.patientId,
    relationship: access.relationship,
    permissions: access.permissions,
    grantedAt: iso(access.grantedAt)!,
    grantedByUserId: access.grantedByUserId,
    revokedAt: iso(access.revokedAt),
  };
}

export function toClinicDto(clinic: ClinicWithRelations): ClinicDto {
  return {
    id: clinic.id,
    name: clinic.name,
    phone: clinic.phone,
    address: toAddressDto(clinic.address),
    entranceNotes: clinic.entranceNotes,
    operatingNotes: clinic.operatingNotes,
  };
}

export function toAppointmentDto(
  appointment: AppointmentWithRelations,
): AppointmentDto {
  return {
    id: appointment.id,
    patientId: appointment.patientId,
    clinicId: appointment.clinicId,
    startsAt: iso(appointment.startsAt)!,
    expectedDurationMinutes: appointment.expectedDurationMinutes,
    type: appointment.type,
    status: appointment.status,
    coordinationNotes: appointment.coordinationNotes,
    transportRequired: appointment.transportRequired,
    timeZoneLabel: appointment.timeZoneLabel,
    history: appointment.history.map(toStatusChangeDto),
    createdAt: iso(appointment.createdAt)!,
  };
}

function toStatusChangeDto(change: {
  at: Date;
  fromStatus: string;
  toStatus: string;
  actor: string;
  reason: string | null;
}): StatusChangeDto {
  return {
    at: iso(change.at)!,
    from: change.fromStatus,
    to: change.toStatus,
    actor: change.actor,
    reason: change.reason,
  };
}

export function toRideDto(ride: RideWithRelations): RideDto {
  return {
    id: ride.id,
    patientId: ride.patientId,
    appointmentId: ride.appointmentId,
    roundTripGroupId: ride.roundTripGroupId,
    direction: ride.direction,
    pickup: toAddressDto(ride.pickup),
    destination: toAddressDto(ride.destination),
    scheduledPickupAt: iso(ride.scheduledPickupAt)!,
    flexibleReturn: ride.flexibleReturn,
    status: ride.status,
    wheelchairRequired: ride.wheelchairRequired,
    assistanceRequired: ride.assistanceRequired,
    notesForDriver: ride.notesForDriver,
    driver: ride.driver
      ? {
          id: ride.driver.id,
          displayName: ride.driver.displayName,
          rating: ride.driver.rating,
          yearsDriving: ride.driver.yearsDriving,
          vehicle: {
            make: ride.driver.vehicle.make,
            model: ride.driver.vehicle.model,
            color: ride.driver.vehicle.color,
            licensePlate: ride.driver.vehicle.licensePlate,
            isWheelchairAccessible: ride.driver.vehicle.isWheelchairAccessible,
          },
        }
      : null,
    estimate: {
      ruleVersion: ride.priceRuleVersion,
      distanceMiles: ride.distanceMiles,
      durationMinutes: ride.durationMinutes,
      baseCents: ride.baseCents,
      distanceChargeCents: ride.distanceChargeCents,
      timeChargeCents: ride.timeChargeCents,
      surcharges: ride.surcharges.map((s) => ({
        label: s.label,
        amountCents: s.amountCents,
      })),
      totalCents: ride.totalCents,
      minimumApplied: ride.minimumApplied,
    },
    isDelayed: ride.isDelayed,
    delayReason: ride.delayReason,
    cancellationReason: ride.cancellationReason,
    events: ride.events.map((e) => ({
      at: iso(e.at)!,
      title: e.title,
      detail: e.detail,
      isException: e.isException,
    })),
    history: ride.history.map(toStatusChangeDto),
    lastKnownPosition:
      ride.lastLatitude != null &&
      ride.lastLongitude != null &&
      ride.lastCapturedAt != null
        ? {
            latitude: ride.lastLatitude,
            longitude: ride.lastLongitude,
            accuracyMeters: ride.lastAccuracyMeters ?? 12,
            capturedAt: iso(ride.lastCapturedAt)!,
          }
        : null,
    etaMinutes: ride.etaMinutes,
    createdAt: iso(ride.createdAt)!,
    simulationActive: ride.simulationActive,
  };
}

export function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    createdAt: iso(notification.createdAt)!,
    readAt: iso(notification.readAt),
    rideId: notification.rideId,
    appointmentId: notification.appointmentId,
  };
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
