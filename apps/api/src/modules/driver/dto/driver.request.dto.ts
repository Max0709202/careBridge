import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { DRIVER_TRANSITIONS } from '../../../domain/driver-authority';
import { ReportLocationDto } from '../../care/dto/ride.dto';

export class DriverShiftDto {
  @ApiProperty({
    description:
      'A driver may take themselves on and off shift. The dispatcher can too — they are the one who hears about the flat tyre first.',
  })
  @IsBoolean()
  onShift!: boolean;
}

export class AdvanceRideDto {
  @ApiProperty({
    enum: DRIVER_TRANSITIONS,
    enumName: 'DriverRideTransition',
    description:
      'Only the moves that belong to the driver. Cancellation and reassignment are deliberately absent: a ride the driver cannot do is still owed, and telling the family it was called off would be a different and untrue statement.',
  })
  @IsIn(DRIVER_TRANSITIONS)
  to!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/**
 * A flush of the driver app's offline queue.
 *
 * Batched rather than one-at-a-time because the case it exists for is a tunnel,
 * a lift shaft or a dead zone on a county road: the app keeps sampling, holds
 * what it cannot send, and empties the queue when signal returns. Sending those
 * one request at a time would mean a burst of a hundred round trips at exactly
 * the moment the connection is worst.
 */
export class ReportLocationBatchDto {
  @ApiProperty({
    type: [ReportLocationDto],
    maxItems: 240,
    description:
      'Readings in any order; the server sorts them. Two hundred and forty is twenty minutes of the fastest cadence, which is longer than any dead zone this product expects to survive — a queue longer than that is flushed in several batches rather than being silently truncated.',
  })
  @ArrayNotEmpty()
  @ArrayMaxSize(240)
  @ValidateNested({ each: true })
  @Type(() => ReportLocationDto)
  points!: ReportLocationDto[];
}
