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
  @IsUUID() patientId!: string;
  @IsUUID() clinicId!: string;

  @IsISO8601() startsAt!: string;

  @IsInt() @Min(5) @Max(24 * 60) expectedDurationMinutes!: number;

  /**
   * Coarse on purpose. "Specialist" is enough to plan a visit's length and
   * transport; the specialty itself is clinical information we do not need,
   * and will not accept.
   */
  @IsIn(APPOINTMENT_TYPES) type!: (typeof APPOINTMENT_TYPES)[number];

  /**
   * Logistics only: "bring the walker", "Dr Osei's office is on floor 3".
   * Never symptoms, diagnoses, or medication.
   */
  @IsOptional() @IsString() @MaxLength(1000) coordinationNotes?: string;

  @IsOptional() @IsBoolean() transportRequired?: boolean;
}

export class RescheduleAppointmentDto {
  @IsISO8601() startsAt!: string;
}

export class CancelAppointmentDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export { APPOINTMENT_TYPES };
