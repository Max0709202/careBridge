import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter your name.' })
  @MaxLength(120)
  fullName!: string;

  @IsEmail({}, { message: 'That does not look like an email address.' })
  @MaxLength(255)
  email!: string;

  /**
   * Length is the requirement, not symbol classes. A ten-character phrase a
   * person will actually remember beats an eight-character one they will write
   * on a note — and composition rules measurably push people towards the
   * latter. Ten characters matches the client-side hint exactly, so the form
   * never accepts something the server then rejects.
   */
  @IsString()
  @MinLength(10, { message: 'Use at least 10 characters.' })
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsBoolean()
  acceptedTerms?: boolean;
}

export class LoginDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter your password.' })
  password!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;

  /** Revoke every session for this account, not just the one presenting. */
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
