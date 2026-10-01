import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/request-context';
import { Idempotent } from '../../common/idempotency.interceptor';
import { RateLimit } from '../../common/rate-limit.guard';
import { MessagingService } from './messaging.service';
import {
  ColleagueDto,
  ConversationDto,
  MessageDto,
  MessagePageDto,
  UnreadSummaryDto,
} from './messaging.dto';
import {
  MessagePageQueryDto,
  OpenConversationDto,
  SendMessageDto,
} from './dto/messaging.request.dto';

/**
 * Conversations between dispatch, families and drivers. ADR-0014.
 *
 * Every route re-derives who the caller is in the thread; a conversation id is
 * not a capability. Not-found and not-permitted are one 404.
 */
@ApiTags('messaging')
@ApiBearerAuth('access-token')
@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  @ApiOperation({
    summary: 'Threads the caller is in, newest first, with unread counts',
  })
  @ApiOkResponse({ type: [ConversationDto] })
  inbox(@CurrentUser() userId: string): Promise<ConversationDto[]> {
    return this.messaging.inbox(userId);
  }

  @Get('conversations/unread')
  @ApiOperation({ summary: 'Totals for a badge' })
  @ApiOkResponse({ type: UnreadSummaryDto })
  unread(@CurrentUser() userId: string): Promise<UnreadSummaryDto> {
    return this.messaging.unreadSummary(userId);
  }

  @Post('conversations')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Find or open a thread',
    description:
      "Returns the existing thread for this subject if there is one. `organizationId`, `patientId` and `driverId` may be left out where a ride, or the caller being a driver, already says what they are. 409 when the colleague is off shift, or a finished trip's thread has closed.",
  })
  @ApiOkResponse({ type: ConversationDto })
  open(
    @CurrentUser() userId: string,
    @Body() body: OpenConversationDto,
  ): Promise<ConversationDto> {
    return this.messaging.open(userId, body);
  }

  @Get('conversations/:conversationId')
  @ApiOkResponse({ type: ConversationDto })
  conversation(
    @CurrentUser() userId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<ConversationDto> {
    return this.messaging.conversation(userId, conversationId);
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'A page of messages, oldest first' })
  @ApiOkResponse({ type: MessagePageDto })
  messages(
    @CurrentUser() userId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: MessagePageQueryDto,
  ): Promise<MessagePageDto> {
    return this.messaging.messages(userId, conversationId, query);
  }

  @Post('conversations/:conversationId/messages')
  @Idempotent()
  @RateLimit('messageSend')
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Safe to retry with the same `clientMessageId`: the stored message is returned rather than a second one posted.',
  })
  @ApiCreatedResponse({ type: MessageDto })
  send(
    @CurrentUser() userId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: SendMessageDto,
  ): Promise<MessageDto> {
    return this.messaging.send(userId, conversationId, body);
  }

  @Post('conversations/:conversationId/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark the thread read up to now' })
  @ApiNoContentResponse()
  async markRead(
    @CurrentUser() userId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<void> {
    await this.messaging.markRead(userId, conversationId);
  }

  @Get('organizations/:organizationId/colleagues')
  @ApiOperation({
    summary: 'Drivers at the operator the caller can message, on shift first',
    description: 'For a dispatcher at the operator or one of its approved drivers.',
  })
  @ApiOkResponse({ type: [ColleagueDto] })
  colleagues(
    @CurrentUser() userId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<ColleagueDto[]> {
    return this.messaging.colleagues(userId, organizationId);
  }
}
