/**
 * The wire contract.
 *
 * These shapes mirror `CareState` in lib/data/care_state.dart field for field,
 * so the Dart client decodes a snapshot straight into the type its widgets
 * already read. Every mutating endpoint returns a **whole** snapshot rather
 * than a delta: one status change can touch a ride, its appointment, and the
 * notification list, and reconciling three partial responses on the client is
 * how a UI drifts out of step with the server that is supposed to be
 * authoritative.
 *
 * Money crosses the wire as integer cents, never as a decimal string or a
 * float. Times cross as ISO-8601 UTC.
 */

export interface AddressDto {
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

export interface AppUserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
}

export interface EmergencyContactDto {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  isPrimary: boolean;
}

export interface PatientDto {
  id: string;
  preferredName: string;
  legalName: string | null;
  phone: string;
  homeAddress: AddressDto;
  ageBand: string | null;
  preferredLanguage: string;
  mobilityNeeds: string[];
  mobilityNotes: string | null;
  emergencyContacts: EmergencyContactDto[];
  preferredClinicId: string | null;
  archivedAt: string | null;
}

export interface PatientAccessDto {
  userId: string;
  patientId: string;
  relationship: string;
  permissions: string[];
  grantedAt: string;
  grantedByUserId: string | null;
  revokedAt: string | null;
}

export interface ClinicDto {
  id: string;
  name: string;
  phone: string;
  address: AddressDto;
  entranceNotes: string | null;
  operatingNotes: string | null;
}

export interface StatusChangeDto {
  at: string;
  from: string;
  to: string;
  actor: string;
  reason: string | null;
}

export interface AppointmentDto {
  id: string;
  patientId: string;
  clinicId: string;
  startsAt: string;
  expectedDurationMinutes: number;
  type: string;
  status: string;
  coordinationNotes: string | null;
  transportRequired: boolean;
  timeZoneLabel: string;
  history: StatusChangeDto[];
  createdAt: string;
}

export interface VehicleDto {
  make: string;
  model: string;
  color: string;
  licensePlate: string;
  isWheelchairAccessible: boolean;
}

export interface DriverDto {
  id: string;
  displayName: string;
  rating: number;
  yearsDriving: number;
  vehicle: VehicleDto;
}

export interface SurchargeDto {
  label: string;
  amountCents: number;
}

export interface PriceEstimateDto {
  ruleVersion: string;
  distanceMiles: number;
  durationMinutes: number;
  baseCents: number;
  distanceChargeCents: number;
  timeChargeCents: number;
  surcharges: SurchargeDto[];
  totalCents: number;
  minimumApplied: boolean;
}

export interface RideEventDto {
  at: string;
  title: string;
  detail: string | null;
  isException: boolean;
}

export interface TrackingPointDto {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}

export interface RideDto {
  id: string;
  patientId: string;
  appointmentId: string | null;
  roundTripGroupId: string | null;
  direction: string;
  pickup: AddressDto;
  destination: AddressDto;
  scheduledPickupAt: string;
  flexibleReturn: boolean;
  status: string;
  wheelchairRequired: boolean;
  assistanceRequired: boolean;
  notesForDriver: string | null;
  driver: DriverDto | null;
  estimate: PriceEstimateDto;
  isDelayed: boolean;
  delayReason: string | null;
  cancellationReason: string | null;
  events: RideEventDto[];
  history: StatusChangeDto[];
  lastKnownPosition: TrackingPointDto | null;
  etaMinutes: number | null;
  createdAt: string;
  /** Whether the preview trip runner is currently driving this ride. */
  simulationActive: boolean;
}

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  rideId: string | null;
  appointmentId: string | null;
}

export interface CareStateDto {
  user: AppUserDto | null;
  patients: PatientDto[];
  /** Keyed by patient id. Only active grants appear. */
  access: Record<string, PatientAccessDto>;
  clinics: ClinicDto[];
  appointments: AppointmentDto[];
  rides: RideDto[];
  notifications: NotificationDto[];
  selectedPatientId: string | null;
  simplifiedMode: boolean;
}
