import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { AddressInput } from './address.dto';

export class SaveClinicDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone!: string;

  @ApiProperty({ type: () => AddressInput })
  @ValidateNested()
  @Type(() => AddressInput)
  address!: AddressInput;

  /**
   * Where the car should actually stop. Large hospital campuses are the most
   * common cause of a "the driver could not find them" support call.
   */
  @IsOptional() @IsString() @MaxLength(500) entranceNotes?: string;

  @IsOptional() @IsString() @MaxLength(500) operatingNotes?: string;

  /**
   * IANA zone of the clinic. Appointments inherit it, and reminder offsets are
   * measured against it — the appointment happens where the clinic is, not
   * where the family member booking it happens to be sitting.
   */
  @ApiPropertyOptional({ example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]+\/[A-Za-z_\-+0-9/]+$/, {
    message: 'Use an IANA time zone name, for example America/New_York.',
  })
  @MaxLength(64)
  timeZone?: string;
}
