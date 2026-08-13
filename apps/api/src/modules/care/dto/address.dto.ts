import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AddressInput {
  @ApiProperty({ example: 'Home', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  line1!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @ApiProperty({ example: 'NY', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  state!: string;

  @ApiProperty({ maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  postalCode!: string;

  /**
   * "Gate code 4417", "flat is up one flight, no lift", "use the rear door".
   * The single most useful free-text field in the product: it is what stops a
   * driver waiting at the wrong entrance while a patient waits at the right one.
   */
  @ApiPropertyOptional({
    maxLength: 500,
    example: 'Gate code 4417; flat is up one flight, no lift.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  accessNotes?: string;

  @ApiPropertyOptional({
    description:
      'Supply a pin only when the client already has a good one — a dragged marker or an autocomplete pick. Supplying it suppresses server-side geocoding, which is the point: re-geocoding would silently move a marker the user set.',
  })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

/** Helper for the nested-validation boilerplate. */
export function NestedAddress(): PropertyDecorator {
  return (target, key) => {
    ValidateNested()(target, key);
    Type(() => AddressInput)(target, key);
  };
}
