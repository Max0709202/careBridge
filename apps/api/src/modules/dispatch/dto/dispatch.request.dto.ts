import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DRIVER_DOCUMENT_KINDS } from '../../../domain/driver-documents';
import { DRIVER_STATUSES } from '../../../domain/driver-status';

export class CreateVehicleDto {
  @ApiProperty({ maxLength: 40 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  make!: string;
  @ApiProperty({ maxLength: 40 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  model!: string;
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  color!: string;

  @ApiProperty({ maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  licensePlate!: string;

  @ApiProperty()
  @IsBoolean()
  isWheelchairAccessible!: boolean;
}

export class CreateDriverDto {
  @ApiProperty({
    maxLength: 60,
    description: 'First name and last initial. Never a full legal name.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  displayName!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleId!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  yearsDriving?: number;

  @ApiPropertyOptional({
    format: 'email',
    maxLength: 254,
    description:
      'The address this driver will sign into the driver app with. Recorded, not invited: the link is only made once an account exists at that address **and has verified it**, so writing it here grants nothing on its own.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class SetDriverStatusDto {
  @ApiProperty({
    enum: DRIVER_STATUSES,
    enumName: 'DriverStatus',
    description:
      'Drives the lifecycle state machine in src/domain/driver-status.ts. Crossing into or out of `approved` is what moves a billable seat.',
  })
  @IsIn(DRIVER_STATUSES)
  to!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class SetShiftDto {
  @ApiProperty()
  @IsBoolean()
  onShift!: boolean;
}

export class AssignRideDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  driverId!: string;

  @ApiPropertyOptional({
    maxLength: 300,
    description: 'Required when taking a ride off a driver who already had it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class RequestDocumentUploadDto {
  @ApiProperty({
    enum: DRIVER_DOCUMENT_KINDS,
    enumName: 'DriverDocumentKind',
    description:
      'A short list of legal requirements and nothing else. A server that stored whatever arrived would be an operator holding a driver’s passport because the form allowed one.',
  })
  @IsIn(DRIVER_DOCUMENT_KINDS)
  kind!: string;

  @ApiProperty({
    description:
      'Signed into the upload URL, so it is a bound rather than a request: a slot authorised for a JPEG cannot be filled with anything else.',
    example: 'image/jpeg',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  contentType!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'The date printed on the document, where it has one. Not a retention deadline — this is what makes an insurance certificate stop counting the day it lapses.',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  decision!: string;

  @ApiPropertyOptional({
    maxLength: 300,
    description:
      'Required when rejecting. “Rejected” with no reason is a driver who re-uploads the same unreadable photograph three times.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
