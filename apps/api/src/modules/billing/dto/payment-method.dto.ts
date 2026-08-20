import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AttachPaymentMethodDto {
  @ApiProperty({
    description:
      'A reference the client obtained directly from the payment processor. Never a card number — no endpoint in this system accepts one (ADR-0006).',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;
}
