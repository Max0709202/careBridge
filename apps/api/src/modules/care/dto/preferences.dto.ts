import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdatePreferencesDto {
  /** Larger type, higher contrast, fewer controls. */
  @IsOptional() @IsBoolean() simplifiedMode?: boolean;

  @IsOptional() @IsUUID() selectedPatientId?: string;
}
