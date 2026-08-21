import { ApiProperty } from '@nestjs/swagger';

import { DRIVER_STATUSES } from '../../domain/driver-status';
import {
  DRIVER_DOCUMENT_KINDS,
  DRIVER_DOCUMENT_STATUSES,
} from '../../domain/driver-documents';

/**
 * The operator-facing wire contract.
 *
 * Same conventions as care.dto.ts — classes rather than interfaces, every type
 * written out — because the same generator reads them.
 *
 * One rule differs from the family side and is worth stating: a dispatcher is
 * *supposed* to see a patient's name, pickup address and appointment time.
 * They are arranging the car. What they may not see is anything clinical,
 * because nothing clinical is stored, and what they may not see is a patient
 * belonging to nobody they are dispatching for — which is enforced by the
 * queue query rather than by the mapper.
 */

export class VehicleDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
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

  @ApiProperty({ enum: DRIVER_STATUSES, enumName: 'DriverStatus' }) status!: string;

  @ApiProperty({
    type: Boolean,
    description:
      'Working right now. Separate from status, which is whether the company has said this person may carry a passenger at all.',
  })
  onShift!: boolean;

  @ApiProperty({ type: Number, format: 'float' }) rating!: number;
  @ApiProperty({ type: 'integer' }) yearsDriving!: number;
  @ApiProperty({ type: () => VehicleDto }) vehicle!: VehicleDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  approvedAt!: string | null;

  @ApiProperty({ type: String, nullable: true }) suspensionReason!: string | null;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether this driver counts towards the operator’s per-driver subscription. True for approved drivers and nobody else.',
  })
  occupiesSeat!: boolean;

  @ApiProperty({ type: 'integer' }) activeRideCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The address this driver will sign into the driver app with, as recorded by the operator.',
  })
  invitedEmail!: string | null;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the driver has actually opened the app and claimed this roster place. A roster full of approved drivers who have never signed in is a shift nobody will answer for.',
  })
  hasAppAccount!: boolean;
}

export class DispatchCandidateDto {
  @ApiProperty({ type: String, format: 'uuid' }) driverId!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: Boolean }) eligible!: boolean;

  @ApiProperty({
    type: [String],
    description:
      'Every reason this driver cannot take the trip, not just the first — "nobody is on shift" and "nobody has an accessible vehicle" need different phone calls.',
  })
  reasons!: string[];
}

export class DispatchQueueItemDto {
  @ApiProperty({ type: String, format: 'uuid' }) rideId!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: String }) patientName!: string;
  @ApiProperty({ type: String }) pickupLine!: string;
  @ApiProperty({ type: String }) destinationLine!: string;
  @ApiProperty({ type: String, format: 'date-time' }) scheduledPickupAt!: string;
  @ApiProperty({ type: Boolean }) wheelchairRequired!: boolean;
  @ApiProperty({ type: Boolean }) assistanceRequired!: boolean;

  @ApiProperty({
    type: String,
    enum: ['overdue', 'imminent', 'soon', 'later'],
    enumName: 'DispatchUrgency',
    description:
      '"overdue" is its own band rather than the top of "imminent": a pickup time that has passed with nobody assigned is a failure already in progress — somebody is standing in a hallway waiting.',
  })
  urgency!: string;

  @ApiProperty({ type: () => [DispatchCandidateDto] })
  candidates!: DispatchCandidateDto[];
}

export class DispatchQueueDto {
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: () => [DispatchQueueItemDto] }) items!: DispatchQueueItemDto[];

  @ApiProperty({
    type: 'integer',
    description: 'Drivers on shift and free right now, across the whole roster.',
  })
  availableDrivers!: number;
}

export class DriverDocumentDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;

  @ApiProperty({ enum: DRIVER_DOCUMENT_KINDS, enumName: 'DriverDocumentKind' })
  kind!: string;

  @ApiProperty({ enum: DRIVER_DOCUMENT_STATUSES, enumName: 'DriverDocumentStatus' })
  status!: string;

  @ApiProperty({ type: String }) contentType!: string;

  @ApiProperty({ type: 'integer', nullable: true }) byteSize!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'The date printed on the document. An approved certificate past this date stops counting immediately, rather than when a sweep next notices.',
  })
  expiresAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: string | null;

  @ApiProperty({ type: String, nullable: true }) reviewNote!: string | null;

  @ApiProperty({
    type: Boolean,
    description:
      'Replaced by a newer upload. Kept rather than deleted, so “which certificate was in force in March” stays answerable.',
  })
  superseded!: boolean;
}

export class DriverComplianceDto {
  @ApiProperty({
    type: Boolean,
    description:
      'Whether the paperwork permits approving this driver. Re-checked inside the approval transaction — the console greys the button out, but a check only the screen performs is one a second tab can race past.',
  })
  compliant!: boolean;

  @ApiProperty({
    type: [String],
    description:
      'Every required document still missing, not just the first. Deliberately excludes the background check: a platform lookup is not what makes somebody safe, and treating it as such would be a claim this product does not make.',
  })
  missing!: string[];

  @ApiProperty({
    type: [String],
    description: 'Valid today, lapsing within thirty days.',
  })
  expiringSoon!: string[];

  @ApiProperty({ type: () => [DriverDocumentDto] })
  documents!: DriverDocumentDto[];
}

export class PresignedUploadDto {
  @ApiProperty({ type: String, format: 'uuid' }) documentId!: string;

  @ApiProperty({
    type: String,
    description:
      'PUT the file here. The bytes never pass through this API: a multipart body would be a copy of the file in the heap of a process that is also holding a WebSocket open for every live ride.',
  })
  url!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Send these exactly. They are covered by the signature, which is what stops a slot authorised for a 4 MB photograph being filled with 400 MB of something else.',
  })
  headers!: Record<string, string>;

  @ApiProperty({ type: 'integer' }) expiresInSeconds!: number;
  @ApiProperty({ type: 'integer' }) maxBytes!: number;
}

export class DocumentViewUrlDto {
  @ApiProperty({
    type: String,
    description:
      'Short-lived on purpose. A link to a driver’s licence that works for a week is a link that ends up in a chat message, an email thread and a browser history.',
  })
  url!: string;

  @ApiProperty({ type: 'integer' }) expiresInSeconds!: number;
}
