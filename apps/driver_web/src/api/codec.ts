/**
 * Wire types in, domain types out. A port of lib/data/driver_codec.dart.
 *
 * An unknown value must not crash a driver's screen mid-shift. A status this
 * build has never heard of means the server is ahead of the app, so an
 * unrecognised transition is **dropped** (offering a button this build cannot
 * honour is worse than offering none), while an unrecognised ride status makes
 * the job unusable and the job is dropped whole.
 */
import type { DriverProfile, Job, Place, Vehicle } from '../domain/models';
import { parseRideStatus, type RideStatus } from '../domain/rideStatus';
import type { components } from './schema';

type S = components['schemas'];

export type DriverDocuments = S['DriverDocumentsDto'];
export type DriverDocument = S['DriverDocumentDto'];
export type DocumentKind = S['DriverDocumentKind'];
export type PresignedUpload = S['PresignedUploadDto'];
export type FlushResult = S['LocationBatchResultDto'];

export const vehicleFromWire = (dto: S['VehicleDto']): Vehicle => ({
  make: dto.make,
  model: dto.model,
  color: dto.color,
  licensePlate: dto.licensePlate,
  isWheelchairAccessible: dto.isWheelchairAccessible,
});

export const profileFromWire = (dto: S['DriverProfileDto']): DriverProfile => ({
  driverId: dto.driverId,
  organizationId: dto.organizationId,
  organizationName: dto.organizationName,
  displayName: dto.displayName,
  status: dto.status,
  onShift: dto.onShift,
  canWork: dto.canWork,
  vehicle: vehicleFromWire(dto.vehicle),
  suspensionReason: dto.suspensionReason ?? null,
  rejectionReason: dto.rejectionReason ?? null,
});

export const placeFromWire = (dto: S['AddressDto']): Place => ({
  label: dto.label,
  line1: dto.line1,
  line2: dto.line2 ?? null,
  city: dto.city,
  state: dto.state,
  postalCode: dto.postalCode,
  accessNotes: dto.accessNotes ?? null,
});

export function jobFromWire(dto: S['DriverRideDto']): Job | null {
  const status = parseRideStatus(dto.status);
  if (status === null) return null;

  return {
    id: dto.id,
    status,
    scheduledPickupAt: new Date(dto.scheduledPickupAt),
    passengerName: dto.passengerName,
    passengerPhone: dto.passengerPhone ?? null,
    pickup: placeFromWire(dto.pickup),
    destination: placeFromWire(dto.destination),
    wheelchairRequired: dto.wheelchairRequired,
    assistanceRequired: dto.assistanceRequired,
    notesForDriver: dto.notesForDriver ?? null,
    isDelayed: dto.isDelayed,
    availableTransitions: (dto.availableTransitions ?? [])
      .map(parseRideStatus)
      .filter((s): s is RideStatus => s !== null),
    noShowAvailableInSeconds: dto.noShowAvailableInSeconds ?? null,
  };
}
