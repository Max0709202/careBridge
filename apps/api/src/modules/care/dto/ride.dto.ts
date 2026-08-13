import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { RIDE_STATUSES } from '../../../domain/ride-status';

export class RequestTransportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  appointmentId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  pickupAt!: string;

  /**
   * A round trip produces **two rides** sharing a group id, not one ride with
   * two legs: each is assigned, tracked, cancelled and priced independently.
   */
  @ApiProperty({
    description:
      'A round trip produces **two rides** sharing a group id, not one ride with two legs: each is assigned, tracked, cancelled and priced independently.',
  })
  @IsBoolean()
  roundTrip!: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notesForDriver?: string;
}

export class CancelRideDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;
}

export class TransitionRideDto {
  @ApiProperty({ enum: RIDE_STATUSES, enumName: 'RideStatus' })
  @IsIn(RIDE_STATUSES)
  to!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class SetDelayDto {
  @ApiProperty()
  @IsBoolean()
  delayed!: boolean;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ReportLocationDto {
  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracyMeters?: number;

  /**
   * When the **device** took the reading, not when the server received it.
   * Every freshness label ages against this, so the server judges it before
   * storing — see `checkPositionFreshness`.
   */
  @ApiProperty({
    format: 'date-time',
    description:
      'When the **device** took the reading, not when the server received it. Every freshness label ages against this, so the server judges it before storing.',
  })
  @IsISO8601()
  capturedAt!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  etaMinutes?: number;
}
