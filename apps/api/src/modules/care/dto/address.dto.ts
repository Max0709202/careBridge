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
  @IsString() @IsNotEmpty() @MaxLength(80) label!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) line1!: string;

  @IsOptional() @IsString() @MaxLength(200) line2?: string;

  @IsString() @IsNotEmpty() @MaxLength(120) city!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) state!: string;
  @IsString() @IsNotEmpty() @MaxLength(20) postalCode!: string;

  /**
   * "Gate code 4417", "flat is up one flight, no lift", "use the rear door".
   * The single most useful free-text field in the product: it is what stops a
   * driver waiting at the wrong entrance while a patient waits at the right one.
   */
  @IsOptional() @IsString() @MaxLength(500) accessNotes?: string;

  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
}

/** Helper for the nested-validation boilerplate. */
export function NestedAddress(): PropertyDecorator {
  return (target, key) => {
    ValidateNested()(target, key);
    Type(() => AddressInput)(target, key);
  };
}
