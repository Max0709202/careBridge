import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { AddressInput } from './address.dto';

export class SaveClinicDto {
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) phone!: string;

  @ValidateNested()
  @Type(() => AddressInput)
  address!: AddressInput;

  /**
   * Where the car should actually stop. Large hospital campuses are the most
   * common cause of a "the driver could not find them" support call.
   */
  @IsOptional() @IsString() @MaxLength(500) entranceNotes?: string;

  @IsOptional() @IsString() @MaxLength(500) operatingNotes?: string;
}
