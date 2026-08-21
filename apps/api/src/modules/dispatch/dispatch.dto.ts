import { ApiProperty } from '@nestjs/swagger';

import { DRIVER_STATUSES } from '../../domain/driver-status';

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
