import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const APPOINTMENT_TYPES = [
  'primaryCare',
  'specialist',
  'imaging',
  'labWork',
  'therapy',
  'dental',
  'vision',
  'followUp',
  'other',
] as const;

export class CreateAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  patientId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clinicId!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'UTC. Reminder offsets are measured against the clinic’s local wall time, which the appointment inherits from the clinic record.',
  })
  @IsISO8601()
  startsAt!: string;

  @ApiProperty({ minimum: 5, maximum: 1440 })
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  expectedDurationMinutes!: number;

  /**
   * Coarse on purpose. "Specialist" is enough to plan a visit's length and
   * transport; the specialty itself is clinical information we do not need,
   * and will not accept.
   */
  @ApiProperty({
    enum: APPOINTMENT_TYPES,
    enumName: 'AppointmentType',
    description:
      'Coarse on purpose. "Specialist" is enough to plan a visit’s length and transport; the specialty itself is clinical information this API does not accept.',
  })
  @IsIn(APPOINTMENT_TYPES)
  type!: (typeof APPOINTMENT_TYPES)[number];

  /**
   * Logistics only: "bring the walker", "Dr Osei's office is on floor 3".
   * Never symptoms, diagnoses, or medication.
   */
  @ApiPropertyOptional({
    maxLength: 1000,
    description:
      'Logistics only: "bring the walker", "Dr Osei’s office is on floor 3". Never symptoms, diagnoses or medication.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  coordinationNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  transportRequired?: boolean;
}

export class RescheduleAppointmentDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  startsAt!: string;
}

export class CancelAppointmentDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export { APPOINTMENT_TYPES };
