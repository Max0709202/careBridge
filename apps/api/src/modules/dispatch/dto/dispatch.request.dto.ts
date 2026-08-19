import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
