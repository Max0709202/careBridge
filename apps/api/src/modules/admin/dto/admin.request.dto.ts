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
  MinLength,
} from 'class-validator';

export class AuditQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({
    maxLength: 80,
    description: 'Matched as a prefix, so `driver.` returns everything about drivers.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description:
      'From the previous page. Keyset rather than an offset: an audit log is appended to constantly, and an offset would skip or repeat rows between pages.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cursor?: string;
}

export class SetFeatureFlagDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercent!: number;

  @ApiPropertyOptional({
    description:
      'Required when narrowing a rollout. Taking a feature away from people who already had it reads to them as a bug, so it has to be said out loud rather than typed by accident.',
  })
  @IsOptional()
  @IsBoolean()
  confirmNarrowing?: boolean;
}

export class IssueRefundDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentId!: string;

  @ApiProperty({
    minimum: 1,
    description:
      'Integer cents, never a float. Bounded above by what is left on the payment.',
  })
  @IsInt()
  @Min(1)
  amountCents!: number;

  @ApiProperty({
    maxLength: 300,
    description:
      'Required. An unexplained credit is something somebody has to justify to an accountant a quarter later, by which time whoever issued it has forgotten.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class RefundQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'succeeded', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'succeeded', 'failed'])
  status?: string;
}
