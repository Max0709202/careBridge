import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    description: 'Larger type, higher contrast, fewer controls.',
  })
  @IsOptional()
  @IsBoolean()
  simplifiedMode?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Persisted per account so a refresh or a new device lands the user back where they were. A selection whose grant has since been revoked is dropped on read rather than stored forever.',
  })
  @IsOptional()
  @IsUUID()
  selectedPatientId?: string;
}
