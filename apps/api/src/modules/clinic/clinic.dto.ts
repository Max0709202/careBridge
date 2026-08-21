import { ApiProperty } from '@nestjs/swagger';

/**
 * What a clinic sees.
 *
 * The restraint here is the whole design. A clinic knows an enormous amount
 * about its own patients already — but it knows it as a clinic, in its own
 * records. What CareBridge holds is a *family's* view of somebody, and the
 * portal must not become a second route to it.
 *
 * So: the preferred name, when they are expected, whether a car is coming and
 * how far away it is. **No home address**, not even on the return leg the
 * clinic itself dispatches — the car knows where it is going and the
 * receptionist does not need to. No telephone number, no care circle, no
 * appointment history at another clinic. Nothing about mobility beyond whether
 * a wheelchair-accessible vehicle is needed, which is a fact about the car.
 */

export class ClinicSiteDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) addressLine!: string;
  @ApiProperty({ type: String }) timeZone!: string;
}

export class ExpectedArrivalDto {
  @ApiProperty({ type: String, format: 'uuid' }) appointmentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) clinicId!: string;
  @ApiProperty({ type: String }) clinicName!: string;

  @ApiProperty({
    type: String,
    description: 'The name the family uses. Never a full legal name.',
  })
  patientName!: string;

  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String }) appointmentType!: string;

  @ApiProperty({
    enum: ['expected', 'checkedIn', 'readyForReturn', 'returning', 'finished'],
    description:
      'Checking in is deliberately **not** inferred from the ride completing. A completed ride says a car reached an address; a check-in says somebody inside the building saw the patient, and the gap between the two is the case this product exists for.',
  })
  stage!: string;

  @ApiProperty({ type: String, nullable: true }) outboundStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) returnStatus!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: 'Minutes until the car arrives, when one is on its way.',
  })
  etaMinutes!: number | null;

  @ApiProperty({ type: String, nullable: true }) driverName!: string | null;
  @ApiProperty({ type: String, nullable: true }) vehicleDescription!: string | null;

  @ApiProperty({ type: Boolean }) wheelchairRequired!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkedInAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readyForReturnAt!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'How long since the clinic said the visit was over. Shown because the person who pressed the button is standing next to somebody in a coat by the door.',
  })
  waitingMinutes!: number | null;

  @ApiProperty({
    type: Boolean,
    description: 'The wait has stopped being ordinary. Twenty-five minutes.',
  })
  overdue!: boolean;

  @ApiProperty({
    type: Boolean,
    description: 'Whether the “send a car home” button should do anything.',
  })
  canDispatchReturn!: boolean;

  @ApiProperty({ type: String, nullable: true })
  cannotDispatchReason!: string | null;
}

export class ClinicDayDto {
  @ApiProperty({ type: String, description: 'The clinic-local date, ISO.' })
  date!: string;

  @ApiProperty({ type: () => [ExpectedArrivalDto] })
  arrivals!: ExpectedArrivalDto[];

  @ApiProperty({
    type: 'integer',
    description: 'Patients the clinic has said are ready, still waiting for a car.',
  })
  waitingForReturn!: number;

  @ApiProperty({ type: 'integer' }) overdueReturns!: number;
}
