import { ApiProperty } from '@nestjs/swagger';
import { FamilyPermission, RelationshipType } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({
    format: 'email',
    description:
      'The invitation is bound to this address: it can only be accepted by an account signed in as this address, with the address verified.',
  })
  @IsEmail({}, { message: 'That does not look like an email address.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ enum: RelationshipType, enumName: 'RelationshipType' })
  @IsEnum(RelationshipType)
  relationship!: RelationshipType;

  @ApiProperty({
    enum: FamilyPermission,
    enumName: 'FamilyPermission',
    isArray: true,
    description:
      'Must include viewProfile, and may not exceed what the inviter holds — nobody hands out more access than they have.',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'Choose at least one permission to grant.' })
  @IsEnum(FamilyPermission, { each: true })
  permissions!: FamilyPermission[];
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'The single-use token from the invitation link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class InvitationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  patientId!: string;

  @ApiProperty({
    example: 'a••••@example.com',
    description:
      'Masked. Enough for the invitee to recognise their own address; not enough for the rest of the circle to harvest one.',
  })
  emailHint!: string;

  @ApiProperty({ enum: RelationshipType, enumName: 'RelationshipType' })
  relationship!: RelationshipType;

  @ApiProperty({
    enum: FamilyPermission,
    enumName: 'FamilyPermission',
    isArray: true,
  })
  permissions!: FamilyPermission[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({
    enum: ['pending', 'accepted', 'revoked', 'expired'],
    enumName: 'InvitationStatus',
  })
  status!: 'pending' | 'accepted' | 'revoked' | 'expired';
}
