import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { CALL_STATUSES } from '../../domain/relay-calls';

export const CALL_PARTY_KINDS = [
  'patient',
  'familyMember',
  'driver',
  'dispatch',
] as const;

/**
 * Someone the caller may ring from here. Never carries a number — the relay
 * exists so that nobody learns one.
 */
export class CallTargetDto {
  @ApiProperty({ enum: CALL_PARTY_KINDS, enumName: 'CallPartyKind' }) kind!: string;
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Patient, user, driver or organisation id, as `kind` says.',
  })
  id!: string;
  @ApiProperty({
    type: String,
    description:
      '"Eleanor (patient)", "Sarah (daughter)", "Meridian Transit dispatch".',
  })
  label!: string;
  @ApiProperty({ type: Boolean }) available!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why not, in words to show: no number on file, calling not set up.',
  })
  unavailableReason!: string | null;
}

export class CallSessionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CALL_STATUSES, enumName: 'CallStatus' }) status!: string;
  @ApiProperty({ enum: CALL_PARTY_KINDS, enumName: 'CallPartyKind' })
  calleeKind!: string;
  @ApiProperty({ type: String }) calleeLabel!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) conversationId!:
    | string
    | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) rideId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) answeredAt!:
    | string
    | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt!:
    | string
    | null;
  @ApiProperty({ type: Number, nullable: true }) durationSeconds!: number | null;
}

export class CallCalleeDto {
  @ApiProperty({ enum: CALL_PARTY_KINDS, enumName: 'CallPartyKind' })
  @IsIn(CALL_PARTY_KINDS)
  kind!: (typeof CALL_PARTY_KINDS)[number];

  @ApiProperty({ type: String, format: 'uuid', description: 'From the call target.' })
  @IsUUID()
  id!: string;
}

/** Where a call is placed from. One of the two. */
export class CallContextQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  rideId?: string;
}

export class StartCallDto extends CallContextQueryDto {
  @ApiProperty({ type: () => CallCalleeDto })
  @ValidateNested()
  @Type(() => CallCalleeDto)
  callee!: CallCalleeDto;
}

/** The number your own phone rings on when you place a relay call. Only ever shown to you. */
export class MyNumberDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'E.164, or null if none is set.',
  })
  phone!: string | null;
}

export class SetMyNumberDto {
  @ApiProperty({
    type: String,
    maxLength: 40,
    description:
      'Written any reasonable way; stored as E.164. An empty string removes it.',
  })
  @IsString()
  @MaxLength(40)
  phone!: string;
}
