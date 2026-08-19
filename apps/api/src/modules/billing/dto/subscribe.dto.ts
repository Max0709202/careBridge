import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

import { BILLING_INTERVALS, BILLING_PAYERS } from '../../../domain/billing';

export class SubscribeDto {
  @ApiProperty({ description: 'Plan code, e.g. "family-standard" or "dispatch-core".' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  planCode!: string;

  @ApiProperty({ enum: BILLING_INTERVALS, enumName: 'BillingInterval' })
  @IsIn(BILLING_INTERVALS)
  interval!: string;
}

export class ChangeIntervalDto {
  @ApiProperty({
    enum: BILLING_INTERVALS,
    enumName: 'BillingInterval',
    description:
      'The unused remainder of the current period is credited; a fresh period starts today. Annual → monthly produces a credit carried forward, not a refund.',
  })
  @IsIn(BILLING_INTERVALS)
  interval!: string;
}

export class ListPlansQueryDto {
  @ApiPropertyOptional({ enum: BILLING_PAYERS, enumName: 'BillingPayer' })
  @IsIn([...BILLING_PAYERS])
  payer!: string;
}

export class QuoteSeatsQueryDto {
  @ApiProperty({
    type: Number,
    description:
      'Driver count to price, for an operator sizing a plan before committing.',
  })
  @IsInt()
  @Min(0)
  seats!: number;
}
