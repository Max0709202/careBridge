import { ApiProperty } from '@nestjs/swagger';

import { AddressDto } from '../care/care.dto';
import { DriverDocumentDto, VehicleDto } from '../dispatch/dispatch.dto';
import { DRIVER_STATUSES } from '../../domain/driver-status';
import { RIDE_STATUSES } from '../../domain/ride-status';

/**
 * What the driver app is told, and — more to the point — what it is not.
 *
 * A driver is not a dispatcher and not a family member. They are shown exactly
 * what is needed to collect one person and deliver them: a name to call out, a
 * telephone number to ring from the kerb, two addresses, and whether a
 * wheelchair is coming. There is no medical field to withhold because none is
 * stored anywhere, but there is no *history* here either: a ride the driver has
 * finished leaves this surface entirely, taking the passenger's address and
 * telephone number with it. A driver's record of who they carried belongs to
 * the operator, not to a phone in a glovebox.
 */

export class DriverProfileDto {
  @ApiProperty({ type: String, format: 'uuid' }) driverId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;

  @ApiProperty({
    type: String,
    description:
      'Shown in the app so a driver working for two companies can tell at a glance which one is dispatching them.',
  })
  organizationName!: string;

  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ enum: DRIVER_STATUSES, enumName: 'DriverStatus' }) status!: string;
  @ApiProperty({ type: Boolean }) onShift!: boolean;
  @ApiProperty({ type: () => VehicleDto }) vehicle!: VehicleDto;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether this driver may go on shift at all. False until the operator has approved them, and false again the moment they are suspended.',
  })
  canWork!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Why the operator stopped them. Shown to the driver: being locked out of your own job with no reason given is how support queues fill up.',
  })
  suspensionReason!: string | null;
}

export class DriverRideDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: RIDE_STATUSES, enumName: 'RideStatus' }) status!: string;

  @ApiProperty({ type: String, format: 'date-time' }) scheduledPickupAt!: string;
  @ApiProperty({ type: String }) direction!: string;

  @ApiProperty({
    type: String,
    description: 'The name to call out at the door. Never a full legal name.',
  })
  passengerName!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'For ringing from the kerb, which is what stops a five-minute wait becoming a no-show.',
  })
  passengerPhone!: string | null;

  @ApiProperty({ type: () => AddressDto }) pickup!: AddressDto;
  @ApiProperty({ type: () => AddressDto }) destination!: AddressDto;

  @ApiProperty({ type: Boolean }) wheelchairRequired!: boolean;
  @ApiProperty({ type: Boolean }) assistanceRequired!: boolean;

  @ApiProperty({ type: String, nullable: true }) notesForDriver!: string | null;
  @ApiProperty({ type: Boolean }) isDelayed!: boolean;

  @ApiProperty({
    type: [String],
    description:
      'The moves this driver may make right now — the intersection of what the ride allows and what belongs to the driver. Advisory: the server asserts it again.',
  })
  availableTransitions!: string[];

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Seconds left on the kerbside wait before a no-show may be declared, or null when a no-show is not on offer at all.',
  })
  noShowAvailableInSeconds!: number | null;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the app should be sampling location for this ride. Derived from the status by the same rule the write path enforces, so the app is never asked to send what the server would refuse.',
  })
  shareLocation!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastCapturedAt!: string | null;
}

export class LocationBatchResultDto {
  @ApiProperty({
    type: 'integer',
    description: 'Readings written to the journey record.',
  })
  stored!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Readings the server declined to keep — stamped in the future, or already held from an earlier flush of the same queue.',
  })
  ignored!: number;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the batch moved the position the family sees. False for a batch that drained late: its readings are history, and history must not overwrite a fresher position.',
  })
  positionUpdated!: boolean;
}

export class DriverDocumentsDto {
  @ApiProperty({
    type: Boolean,
    description: 'Whether the paperwork permits the operator approving this driver.',
  })
  compliant!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Every required document still wanted, not just the first.',
  })
  missing!: string[];

  @ApiProperty({ type: [String] }) expiringSoon!: string[];

  @ApiProperty({
    type: () => [DriverDocumentDto],
    description:
      'Including the rejection note. Being told “you cannot drive” without being told which document and why is how somebody re-uploads the same unreadable photograph three times and then telephones.',
  })
  documents!: DriverDocumentDto[];
}
