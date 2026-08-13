import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CareStateDto } from '../care/care.dto';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Password length, in one place.
 *
 * Length is the requirement, not symbol classes. A ten-character phrase a
 * person will actually remember beats an eight-character one they will write
 * on a note — and composition rules measurably push people towards the latter.
 * Ten characters matches the client-side hint exactly, so the form never
 * accepts something the server then rejects.
 */
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 256;

export class RegisterDto {
  @ApiProperty({ example: 'Ada Okonkwo', maxLength: 120 })
  @IsString()
  @IsNotEmpty({ message: 'Enter your name.' })
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: 'ada@example.com', format: 'email' })
  @IsEmail({}, { message: 'That does not look like an email address.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Use at least ${PASSWORD_MIN} characters.` })
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Records a terms and privacy consent. Consent is an explicit act, never inferred from use of the app.',
  })
  @IsOptional()
  @IsBoolean()
  acceptedTerms?: boolean;

  @ApiPropertyOptional({
    example: 'America/New_York',
    description:
      'IANA zone. Reminder scheduling is computed in it, so "the evening before" means the user’s evening.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]+\/[A-Za-z_\-+0-9/]+$/, {
    message: 'Use an IANA time zone name, for example America/New_York.',
  })
  @MaxLength(64)
  timeZone?: string;
}

export class LoginDto {
  @ApiProperty({ format: 'email' })
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Enter your password.' })
  password!: string;

  @ApiPropertyOptional({
    description:
      'Six-digit authenticator code, or a recovery code. Required only for accounts with two-factor authentication confirmed.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  mfaCode?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiPropertyOptional({
    description:
      'Revoke every session for this account. Also raises the token version, so access tokens already issued stop working immediately rather than at their next expiry.',
  })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}

export class EmailOnlyDto {
  @ApiProperty({ format: 'email' })
  @IsEmail({}, { message: 'That does not look like an email address.' })
  @MaxLength(255)
  email!: string;
}

export class TokenDto {
  @ApiProperty({ description: 'The single-use token from the emailed link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Use at least ${PASSWORD_MIN} characters.` })
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Enter your current password.' })
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `Use at least ${PASSWORD_MIN} characters.` })
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class MfaCodeDto {
  @ApiProperty({ description: 'Six-digit authenticator code, or a recovery code.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  code!: string;
}

// ─── responses ──────────────────────────────────────────────────────────────

export class TokenPairDto {
  @ApiProperty({
    description:
      'Short-lived JWT. Carries the user id, a token version and the session id — never patient ids or a permission list, which are resolved server-side per request so revocation takes effect on the next call.',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Opaque, single-use, rotated on every refresh. Store it in the platform keychain, never in shared preferences.',
  })
  refreshToken!: string;

  @ApiProperty({ type: 'integer' })
  expiresInSeconds!: number;
}

export class SessionResponseDto extends TokenPairDto {
  @ApiProperty({
    type: () => CareStateDto,
    description:
      'The whole snapshot, so the app has everything it needs to render its first screen without a second round trip. For a new account this is genuinely empty — the first-run experience should be the one a real user gets, not a seeded one.',
  })
  state!: CareStateDto;
}

export class SessionSummaryDto {
  @ApiProperty({
    description:
      'The refresh-token family id. Stable for the life of one sign-in, which is what makes it the thing a person recognises and revokes — individual tokens rotate every few minutes.',
  })
  id!: string;

  @ApiProperty({ example: 'iPhone · Safari' })
  deviceLabel!: string;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastUsedAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class MfaStatusDto {
  @ApiProperty()
  enrolled!: boolean;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiProperty({ type: 'integer' })
  recoveryCodesRemaining!: number;
}

export class MfaEnrolmentDto {
  @ApiProperty({
    description:
      'Rendered as a QR code by the client. Returned exactly once — it cannot be read back, because a re-readable second factor is not one.',
  })
  otpauthUri!: string;

  @ApiProperty({ description: 'For manual entry when there is no camera.' })
  secretBase32!: string;

  @ApiProperty({
    type: [String],
    description:
      'Shown once, stored only as digests. Support cannot read them back, which is the point — a recoverable recovery code is a social-engineering path.',
  })
  recoveryCodes!: string[];
}
