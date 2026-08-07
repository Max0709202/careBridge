import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { AddressInput } from './address.dto';

const AGE_BANDS = ['under65', 'from65to74', 'from75to84', 'over85'] as const;

const MOBILITY_NEEDS = [
  'walker',
  'wheelchair',
  'cane',
  'oxygen',
  'transferAssistance',
  'escortToDoor',
  'lowVision',
  'hardOfHearing',
  'memorySupport',
] as const;

const RELATIONSHIPS = [
  'son',
  'daughter',
  'spouse',
  'sibling',
  'grandchild',
  'friend',
  'professionalCaregiver',
  'other',
] as const;

const PERMISSIONS = [
  'viewProfile',
  'scheduleAppointments',
  'requestTransport',
  'makePayments',
  'manageAccess',
] as const;

export class EmergencyContactInput {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) relationship!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) phone!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class SavePatientDto {
  /** Required. Someone must be greeted by the name they actually use. */
  @IsString() @IsNotEmpty({ message: 'Enter a preferred name.' }) @MaxLength(120)
  preferredName!: string;

  /**
   * Optional, and collected only when a transport provider or clinic needs it
   * to match their records — never required of everyone.
   */
  @IsOptional() @IsString() @MaxLength(160) legalName?: string;

  @IsString() @IsNotEmpty() @MaxLength(40) phone!: string;

  @ValidateNested()
  @Type(() => AddressInput)
  homeAddress!: AddressInput;

  /**
   * Coarse by design. There is no date-of-birth field anywhere in this API:
   * name + address + DOB is the classic re-identification triple, and nothing
   * in arranging a car needs it.
   */
  @IsOptional() @IsIn(AGE_BANDS) ageBand?: (typeof AGE_BANDS)[number];

  @IsOptional() @IsString() @MaxLength(80) preferredLanguage?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MOBILITY_NEEDS, { each: true })
  mobilityNeeds?: (typeof MOBILITY_NEEDS)[number][];

  @IsOptional() @IsString() @MaxLength(1000) mobilityNotes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactInput)
  emergencyContacts?: EmergencyContactInput[];

  @IsOptional() @IsUUID() preferredClinicId?: string;

  @IsOptional() @IsIn(RELATIONSHIPS) relationship?: (typeof RELATIONSHIPS)[number];
}

export class SetPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: (typeof PERMISSIONS)[number][];
}

export class SelectPatientDto {
  @IsUUID() patientId!: string;
}

/** Re-exported so services can reuse the literal unions. */
export { AGE_BANDS, MOBILITY_NEEDS, PERMISSIONS, RELATIONSHIPS };
