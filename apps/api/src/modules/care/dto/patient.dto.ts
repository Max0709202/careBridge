import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 80, example: 'Neighbour' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  relationship!: string;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class SavePatientDto {
  /** Required. Someone must be greeted by the name they actually use. */
  @ApiProperty({
    maxLength: 120,
    description: 'Required. Someone must be greeted by the name they actually use.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Enter a preferred name.' })
  @MaxLength(120)
  preferredName!: string;

  /**
   * Optional, and collected only when a transport provider or clinic needs it
   * to match their records — never required of everyone.
   */
  @ApiPropertyOptional({
    maxLength: 160,
    description:
      'Collected only when a transport provider or clinic needs it to match their records — never required of everyone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone!: string;

  @ApiProperty({ type: () => AddressInput })
  @ValidateNested()
  @Type(() => AddressInput)
  homeAddress!: AddressInput;

  /**
   * Coarse by design. There is no date-of-birth field anywhere in this API:
   * name + address + DOB is the classic re-identification triple, and nothing
   * in arranging a car needs it.
   */
  @ApiPropertyOptional({
    enum: AGE_BANDS,
    enumName: 'AgeBand',
    description:
      'Coarse by design. There is no date-of-birth field anywhere in this API: name + address + DOB is the classic re-identification triple, and nothing in arranging a car needs it.',
  })
  @IsOptional()
  @IsIn(AGE_BANDS)
  ageBand?: (typeof AGE_BANDS)[number];

  @ApiPropertyOptional({ maxLength: 80, example: 'English' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  preferredLanguage?: string;

  @ApiPropertyOptional({
    enum: MOBILITY_NEEDS,
    enumName: 'MobilityNeed',
    isArray: true,
    description:
      'Operational, not diagnostic. What a driver and a vehicle need to know, and nothing about why.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MOBILITY_NEEDS, { each: true })
  mobilityNeeds?: (typeof MOBILITY_NEEDS)[number][];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mobilityNotes?: string;

  @ApiPropertyOptional({ type: () => EmergencyContactInput, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactInput)
  emergencyContacts?: EmergencyContactInput[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  preferredClinicId?: string;

  @ApiPropertyOptional({
    enum: RELATIONSHIPS,
    enumName: 'RelationshipType',
    description:
      'The creator’s relationship to the patient, recorded on the access grant this call creates.',
  })
  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: (typeof RELATIONSHIPS)[number];
}

export class SetPermissionsDto {
  @ApiProperty({ enum: PERMISSIONS, enumName: 'FamilyPermission', isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions!: (typeof PERMISSIONS)[number][];
}

export class SelectPatientDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  patientId!: string;
}

/** Re-exported so services can reuse the literal unions. */
export { AGE_BANDS, MOBILITY_NEEDS, PERMISSIONS, RELATIONSHIPS };
