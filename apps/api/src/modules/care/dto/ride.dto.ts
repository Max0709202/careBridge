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
  @IsUUID() appointmentId!: string;

  @IsISO8601() pickupAt!: string;

  /**
   * A round trip produces **two rides** sharing a group id, not one ride with
   * two legs: each is assigned, tracked, cancelled and priced independently.
   */
  @IsBoolean() roundTrip!: boolean;

  @IsOptional() @IsString() @MaxLength(500) notesForDriver?: string;
}

export class CancelRideDto {
  @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class TransitionRideDto {
  @IsIn(RIDE_STATUSES as unknown as string[]) to!: string;

  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class SetDelayDto {
  @IsBoolean() delayed!: boolean;

  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class ReportLocationDto {
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;

  @IsOptional() @IsNumber() @Min(0) @Max(10000) accuracyMeters?: number;

  /**
   * When the **device** took the reading, not when the server received it.
   * Every freshness label ages against this, so the server judges it before
   * storing — see `checkPositionFreshness`.
   */
  @IsISO8601() capturedAt!: string;

  @IsOptional() @IsInt() @Min(0) @Max(600) etaMinutes?: number;
}
