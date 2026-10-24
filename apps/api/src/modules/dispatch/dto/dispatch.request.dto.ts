import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { DRIVER_DOCUMENT_KINDS } from '../../../domain/driver-documents';
import { DRIVER_STATUSES } from '../../../domain/driver-status';
import {
  MAX_POLYGON_POINTS,
  MAX_SERVICE_RADIUS_MILES,
  SERVICE_AREA_KINDS,
} from '../../../domain/service-area';

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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "An existing account to drive as, from `POST drivers/account-lookup`. The account is linked straight away and the driver starts as `pendingApproval` rather than `invited`; approval still needs their paperwork. When set, `email` is ignored and the account's own address is recorded.",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class LookupDriverAccountDto {
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    description:
      'The full address the person signed up with. There is no partial match.',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;
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

export class CoordinatesInput {
  @ApiProperty({ minimum: -90, maximum: 90 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}

/**
 * Field-level checks only. Which fields a kind needs, and whether an outline
 * encloses anything, is `parseServiceArea` in src/domain/service-area.ts — the
 * one place those rules live.
 */
export class SetServiceAreaDto {
  @ApiProperty({ enum: SERVICE_AREA_KINDS, enumName: 'ServiceAreaKind' })
  @IsIn(SERVICE_AREA_KINDS)
  kind!: string;

  @ApiPropertyOptional({
    type: () => CoordinatesInput,
    description: 'Required for `radius`: the point the radius is measured from.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesInput)
  center?: CoordinatesInput;

  @ApiPropertyOptional({
    maximum: MAX_SERVICE_RADIUS_MILES,
    description: 'Required for `radius`. Straight-line miles, not road miles.',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Max(MAX_SERVICE_RADIUS_MILES)
  radiusMiles?: number;

  @ApiPropertyOptional({
    type: () => [CoordinatesInput],
    description: `Required for \`polygon\`: the outline, 3 to ${MAX_POLYGON_POINTS} points, not closed (the last point joins the first).`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(MAX_POLYGON_POINTS)
  @ValidateNested({ each: true })
  @Type(() => CoordinatesInput)
  points?: CoordinatesInput[];
}
