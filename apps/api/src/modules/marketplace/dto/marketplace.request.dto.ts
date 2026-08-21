import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SearchCaregiversDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;

  @ApiPropertyOptional({ maxLength: 2 })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'A language they speak.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Integer cents per hour.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxHourlyRateCents?: number;
}

export class CreateBookingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  caregiverId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  patientId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  endsAt!: string;
}

export class CancelBookingDto {
  @ApiProperty({
    maxLength: 300,
    description:
      'Required. A cancellation with no reason is a dispute nobody can settle, and the caregiver has kept the time free.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class ReviewBookingDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RaiseDisputeDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: ['upheld', 'refunded', 'waived'] })
  @IsIn(['upheld', 'refunded', 'waived'])
  outcome!: string;

  @ApiProperty({
    maxLength: 1000,
    description:
      'Required. A decision with no reasoning is one nobody can defend when the same question is asked again.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}

export class SaveCaregiverProfileDto {
  @ApiProperty({ maxLength: 60 })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  bio!: string;

  @ApiProperty({ minimum: 0, maximum: 60 })
  @IsInt()
  @Min(0)
  @Max(60)
  yearsExperience!: number;

  @ApiProperty({ type: [String], maxItems: 8 })
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  languages!: string[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  hourlyRateCents!: number;

  @ApiProperty({ maxLength: 60 })
  @IsString()
  @MaxLength(60)
  serviceAreaCity!: string;

  @ApiProperty({ maxLength: 2 })
  @IsString()
  @MaxLength(2)
  serviceAreaState!: string;
}
