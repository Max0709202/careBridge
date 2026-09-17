import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { DELETION_GRACE_DAYS } from '../../domain/account-deletion';

/**
 * What the deletion screen needs before it offers the button.
 *
 * There is deliberately no "a deletion is already pending" field here, and its
 * absence is a consequence of ADR-0013 rather than an omission. Requesting a
 * deletion signs every device out (step 3) and signing back in cancels it
 * (step 2) — so there is no session in which a pending deletion can be
 * observed, and a field reporting one could only ever be null. The scheduled
 * date reaches the account holder in the response to the request itself, and
 * in the email.
 */
export class DeletionStatusDto {
  @ApiProperty({
    type: [String],
    description:
      'Machine-readable reasons deletion is currently refused: `rideInFlight`, `lastOrganizationOwner`, `unpaidInvoice`. Empty when it would succeed.',
  })
  blockers!: string[];

  @ApiProperty({
    type: [String],
    description:
      'The same reasons, each with the remedy, as shown to the account holder. A refusal with no remedy is what makes somebody email support instead — which is the thing both app stores refuse to accept.',
  })
  blockerMessages!: string[];

  @ApiProperty({
    type: 'integer',
    description: 'The grace period, in days, so the screen can say it.',
    example: DELETION_GRACE_DAYS,
  })
  graceDays!: number;
}

export class DeletionReceiptDto {
  @ApiProperty({ type: String, format: 'date-time' })
  scheduledFor!: string;

  @ApiProperty({ type: 'integer', example: DELETION_GRACE_DAYS })
  graceDays!: number;

  @ApiProperty({
    type: Boolean,
    description:
      'True when a deletion was already pending. The request is idempotent — a second tap, or a retry after a dropped connection, is not a second deletion.',
  })
  alreadyPending!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Everything CareBridge holds about this account, taken before anything changed. Returned in the response rather than left behind an endpoint, because the request signs every device out — so this is the last moment the account holder can be handed their own data. Credentials are deliberately excluded.',
  })
  data!: Record<string, unknown>;
}

export class PublicDeletionRequestDto {
  @ApiProperty({
    example: 'ada@example.com',
    format: 'email',
    description:
      'Always accepted, whatever the address turns out to be. Whether an address has an account is a fact about a person, and for this product that person has a vulnerable relative.',
  })
  @IsEmail({}, { message: 'That does not look like an email address.' })
  @MaxLength(255)
  email!: string;
}

export class DeletionTokenDto {
  @ApiProperty({ description: 'The single-use token from the emailed link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}
