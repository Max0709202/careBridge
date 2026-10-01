import { ApiProperty } from '@nestjs/swagger';

import { CONVERSATION_KINDS } from '../../domain/conversation-access';
import { RIDE_STATUSES } from '../../domain/ride-status';

export const MESSAGE_SENDER_ROLES = [
  'dispatcher',
  'family',
  'driver',
  'system',
] as const;
export const CONVERSATION_ROLES = ['dispatcher', 'family', 'driver'] as const;

export class MessageDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) conversationId!: string;
  @ApiProperty({ enum: MESSAGE_SENDER_ROLES, enumName: 'MessageSenderRole' })
  senderRole!: string;

  @ApiProperty({
    type: String,
    description:
      'Who wrote it, as they were labelled when they wrote it — "Dana · Dispatch", "Marcus T.", "Sarah (daughter)". "Former member" after an account is deleted.',
  })
  senderLabel!: string;

  @ApiProperty({ type: String, maxLength: 2000 }) body!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;

  @ApiProperty({
    type: String,
    description:
      'Echoed back so a client can reconcile its optimistic copy with the stored one.',
  })
  clientMessageId!: string;

  @ApiProperty({ type: Boolean, description: 'Written by the caller.' }) mine!: boolean;
}

/** What a ride-linked thread shows at the top, so it is clear which trip it is about. */
export class ConversationRideDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: RIDE_STATUSES, enumName: 'RideStatus' }) status!: string;
  @ApiProperty({ type: String }) direction!: string;
  @ApiProperty({ type: String, format: 'date-time' }) scheduledPickupAt!: string;

  @ApiProperty({
    type: String,
    description:
      "The passenger's preferred name. Everyone who can read the thread can already see it on the ride.",
  })
  patientName!: string;
}

export class ConversationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CONVERSATION_KINDS, enumName: 'ConversationKind' })
  kind!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) organizationName!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true }) patientId!:
    | string
    | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) driverId!:
    | string
    | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) peerDriverId!:
    | string
    | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) rideId!: string | null;

  @ApiProperty({
    type: String,
    description:
      'The other side, from the caller\'s point of view — "Meridian Transit dispatch" to a family, "Eleanor\'s family" to a dispatcher.',
  })
  title!: string;

  @ApiProperty({ enum: CONVERSATION_ROLES, enumName: 'ConversationRole' })
  myRole!: string;

  @ApiProperty({
    type: Boolean,
    description:
      "False for dispatch in a driver-to-driver thread, and for the family and driver once a finished ride's thread has closed.",
  })
  canPost!: boolean;

  @ApiProperty({ type: () => ConversationRideDto, nullable: true })
  ride!: ConversationRideDto | null;

  @ApiProperty({ type: () => MessageDto, nullable: true })
  lastMessage!: MessageDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastMessageAt!:
    | string
    | null;
  @ApiProperty({ type: Number }) unreadCount!: number;
}

export class MessagePageDto {
  @ApiProperty({ type: () => [MessageDto], description: 'Oldest first.' })
  messages!: MessageDto[];

  @ApiProperty({
    type: Boolean,
    description:
      'Whether there are older messages. Ask again with `before` set to the oldest `createdAt`.',
  })
  hasMore!: boolean;
}

export class ColleagueDto {
  @ApiProperty({ type: String, format: 'uuid' }) driverId!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ type: Boolean }) onShift!: boolean;
}

export class UnreadSummaryDto {
  @ApiProperty({ type: Number }) unreadConversations!: number;
  @ApiProperty({ type: Number }) unreadMessages!: number;
}
