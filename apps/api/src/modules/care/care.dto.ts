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
 *
 * Two conventions in the decorators below are load-bearing rather than
 * decorative, and both exist because the OpenAPI document is generated from
 * them and the Dart client is generated from that:
 *
 *   - **Classes, not interfaces.** An interface leaves no runtime trace, so
 *     `@nestjs/swagger` cannot see it — the snapshot, the largest payload in
 *     the product, would simply be absent from the contract. They are still
 *     used purely as shapes: the mappers return object literals, which
 *     TypeScript accepts structurally.
 *   - **Every type is written out.** `emitDecoratorMetadata` reports the design
 *     type of `string | null` as `Object`, so an inferred decorator turns every
 *     nullable string into an untyped map in the generated client. And
 *     TypeScript's `number` is both `int` and `double`; Dart's is not. Where
 *     the value is a count, an integer or a number of cents, it says so.
 */

import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';

export class AddressDto {
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: String }) line1!: string;
  @ApiProperty({ type: String, nullable: true }) line2!: string | null;
  @ApiProperty({ type: String }) city!: string;
  @ApiProperty({ type: String }) state!: string;
  @ApiProperty({ type: String }) postalCode!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'What stops a driver waiting at the wrong entrance while a patient waits at the right one.',
  })
  accessNotes!: string | null;

  @ApiProperty({ type: Number, format: 'double', nullable: true })
  latitude!: number | null;

  @ApiProperty({ type: Number, format: 'double', nullable: true })
  longitude!: number | null;
}

export class AppUserDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'email' }) email!: string;
  @ApiProperty({ type: String }) fullName!: string;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Null until the address is proven. Nothing is blocked on it except issuing and accepting invitations — but the app needs the fact to prompt, and a prompt is the only reason an unverified address ever gets verified.',
  })
  emailVerifiedAt!: string | null;

  @ApiProperty({
    type: String,
    description: 'IANA zone. Reminder scheduling for this user is computed in it.',
  })
  timeZone!: string;
}

export class EmergencyContactDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) relationship!: string;
  @ApiProperty({ type: String }) phone!: string;
  @ApiProperty({ type: Boolean }) isPrimary!: boolean;
}

export class PatientDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) preferredName!: string;
  @ApiProperty({ type: String, nullable: true }) legalName!: string | null;
  @ApiProperty({ type: String }) phone!: string;

  @ApiProperty({ type: () => AddressDto }) homeAddress!: AddressDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Coarse by design. There is no date of birth anywhere in this API.',
  })
  ageBand!: string | null;

  @ApiProperty({ type: String }) preferredLanguage!: string;
  @ApiProperty({ type: [String] }) mobilityNeeds!: string[];
  @ApiProperty({ type: String, nullable: true }) mobilityNotes!: string | null;

  @ApiProperty({ type: () => [EmergencyContactDto] })
  emergencyContacts!: EmergencyContactDto[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  preferredClinicId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Soft delete. Audit and dispute resolution need the record to survive.',
  })
  archivedAt!: string | null;
}

export class PatientAccessDto {
  @ApiProperty({ type: String, format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) patientId!: string;
  @ApiProperty({ type: String }) relationship!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ type: String, format: 'date-time' }) grantedAt!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Null marks the organiser who created the patient record. They keep manageAccess unconditionally, or a family could lock itself out of its own patient.',
  })
  grantedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt!: string | null;
}

export class ClinicDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) phone!: string;
  @ApiProperty({ type: () => AddressDto }) address!: AddressDto;
  @ApiProperty({ type: String, nullable: true }) entranceNotes!: string | null;
  @ApiProperty({ type: String, nullable: true }) operatingNotes!: string | null;
}

export class StatusChangeDto {
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty({ type: String }) from!: string;
  @ApiProperty({ type: String }) to!: string;
  @ApiProperty({ type: String }) actor!: string;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}

export class AppointmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) patientId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) clinicId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;

  @ApiProperty({ type: 'integer' }) expectedDurationMinutes!: number;

  @ApiProperty({ type: String }) type!: string;
  @ApiProperty({ type: String }) status!: string;

  @ApiProperty({ type: String, nullable: true })
  coordinationNotes!: string | null;

  @ApiProperty({ type: Boolean }) transportRequired!: boolean;

  @ApiProperty({
    type: String,
    description:
      'The label a person reads, e.g. "clinic time" — not the IANA zone the scheduler computes in. Conflating the two is how a reminder fires at 3am.',
  })
  timeZoneLabel!: string;

  @ApiProperty({ type: () => [StatusChangeDto] }) history!: StatusChangeDto[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class VehicleDto {
  @ApiProperty({ type: String }) make!: string;
  @ApiProperty({ type: String }) model!: string;
  @ApiProperty({ type: String }) color!: string;
  @ApiProperty({ type: String }) licensePlate!: string;
  @ApiProperty({ type: Boolean }) isWheelchairAccessible!: boolean;
}

export class DriverDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;

  @ApiProperty({
    type: String,
    description:
      'First name and last initial only. The family needs to recognise the person at the kerb, not to be able to look them up.',
  })
  displayName!: string;

  @ApiProperty({ type: Number, format: 'double' }) rating!: number;
  @ApiProperty({ type: 'integer' }) yearsDriving!: number;
  @ApiProperty({ type: () => VehicleDto }) vehicle!: VehicleDto;
}

export class SurchargeDto {
  @ApiProperty({ type: String }) label!: string;
  @ApiProperty({ type: 'integer' }) amountCents!: number;
}

export class PriceEstimateDto {
  @ApiProperty({
    type: String,
    description:
      'The pricing rule that produced these numbers, so a historical charge can always be explained.',
  })
  ruleVersion!: string;

  @ApiProperty({ type: Number, format: 'double' }) distanceMiles!: number;
  @ApiProperty({ type: 'integer' }) durationMinutes!: number;
  @ApiProperty({ type: 'integer' }) baseCents!: number;
  @ApiProperty({ type: 'integer' }) distanceChargeCents!: number;
  @ApiProperty({ type: 'integer' }) timeChargeCents!: number;

  @ApiProperty({ type: () => [SurchargeDto] }) surcharges!: SurchargeDto[];

  @ApiProperty({ type: 'integer' }) totalCents!: number;
  @ApiProperty({ type: Boolean }) minimumApplied!: boolean;
}

export class RideEventDto {
  @ApiProperty({ type: String, format: 'date-time' }) at!: string;
  @ApiProperty({ type: String }) title!: string;
  @ApiProperty({ type: String, nullable: true }) detail!: string | null;
  @ApiProperty({ type: Boolean }) isException!: boolean;
}

export class TrackingPointDto {
  @ApiProperty({ type: Number, format: 'double' }) latitude!: number;
  @ApiProperty({ type: Number, format: 'double' }) longitude!: number;
  @ApiProperty({ type: Number, format: 'double' }) accuracyMeters!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'When the device took the reading. Every freshness label ages against this and never against when the server received it — a stale position rendered as a confident moving car manufactures false certainty about a vulnerable person.',
  })
  capturedAt!: string;
}

export class RideDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) patientId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  appointmentId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'A round trip is two rides sharing this id, not one ride with two legs — each is assigned, tracked, cancelled and priced independently.',
  })
  roundTripGroupId!: string | null;

  @ApiProperty({ type: String }) direction!: string;
  @ApiProperty({ type: () => AddressDto }) pickup!: AddressDto;
  @ApiProperty({ type: () => AddressDto }) destination!: AddressDto;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledPickupAt!: string;

  @ApiProperty({ type: Boolean }) flexibleReturn!: boolean;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Boolean }) wheelchairRequired!: boolean;
  @ApiProperty({ type: Boolean }) assistanceRequired!: boolean;

  @ApiProperty({ type: String, nullable: true })
  notesForDriver!: string | null;

  @ApiProperty({ type: () => DriverDto, nullable: true })
  driver!: DriverDto | null;

  @ApiProperty({ type: () => PriceEstimateDto }) estimate!: PriceEstimateDto;

  @ApiProperty({
    type: Boolean,
    description:
      'A flag rather than a status, so a delay can be raised and cleared without losing the state the ride must return to.',
  })
  isDelayed!: boolean;

  @ApiProperty({ type: String, nullable: true }) delayReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ type: () => [RideEventDto] }) events!: RideEventDto[];
  @ApiProperty({ type: () => [StatusChangeDto] }) history!: StatusChangeDto[];

  @ApiProperty({ type: () => TrackingPointDto, nullable: true })
  lastKnownPosition!: TrackingPointDto | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Minutes until the driver reaches the stop in question — the pickup while they are on the way, the destination once the passenger is aboard. Computed server-side from the reported position; there is deliberately no field on the position report for a device to set it. Null while the car is standing at a kerb, and null when the address never geocoded.',
  })
  etaMinutes!: number | null;

  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the preview trip runner is currently driving this ride. Removed when the driver app lands.',
  })
  simulationActive!: boolean;
}

export class NotificationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) kind!: string;

  @ApiProperty({
    type: String,
    description:
      'Carries no patient name, clinic name, address or time. A phone on a kitchen table is readable by whoever is in the room.',
  })
  title!: string;

  @ApiProperty({ type: String }) body!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  rideId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  appointmentId!: string | null;
}

/**
 * `@ApiExtraModels` is doing real work here, not decoration.
 *
 * `PatientAccessDto` is referenced only through the raw `$ref` in the
 * `additionalProperties` below — swagger has no decorator to resolve a type
 * through, so without this it never registers the class and the schema is
 * simply absent from the document. The generated Dart client then names a type
 * that was never emitted, which is a compile error in the client and nothing at
 * all on this side.
 */
@ApiExtraModels(PatientAccessDto)
export class CareStateDto {
  @ApiProperty({ type: () => AppUserDto, nullable: true })
  user!: AppUserDto | null;

  @ApiProperty({ type: () => [PatientDto] }) patients!: PatientDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/PatientAccessDto' },
    description:
      'Keyed by patient id. Only active grants appear — a revoked grant closes every surface at once, so the patient, their appointments, their rides and their live position all disappear from the next snapshot together.',
  })
  access!: Record<string, PatientAccessDto>;

  @ApiProperty({ type: () => [ClinicDto] }) clinics!: ClinicDto[];

  @ApiProperty({ type: () => [AppointmentDto] })
  appointments!: AppointmentDto[];

  @ApiProperty({ type: () => [RideDto] }) rides!: RideDto[];

  @ApiProperty({ type: () => [NotificationDto] })
  notifications!: NotificationDto[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  selectedPatientId!: string | null;

  @ApiProperty({ type: Boolean }) simplifiedMode!: boolean;
}
