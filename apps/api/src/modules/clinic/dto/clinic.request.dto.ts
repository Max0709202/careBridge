import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ClinicDayQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    description:
      'Clinic-local date. Defaults to today **in the clinic’s own zone**, not the server’s — a portal that showed yesterday’s list to a west-coast clinic every morning would be useless by nine o’clock.',
  })
  @IsOptional()
  @IsISO8601()
  on?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'One site rather than all of them.',
  })
  @IsOptional()
  @IsUUID()
  clinicId?: string;
}

export class ClaimClinicDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Why this network is claiming this site. Recorded in the audit log — claiming a clinic grants sight of every appointment booked there.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
