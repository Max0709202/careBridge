import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/request-context';
import { RateLimit } from '../../common/rate-limit.guard';
import { CallsService } from './calls.service';
import {
  CallContextQueryDto,
  CallSessionDto,
  CallTargetDto,
  MyNumberDto,
  SetMyNumberDto,
  StartCallDto,
} from './calls.dto';

/**
 * Relay calls. The provider rings the caller's own phone first, then the
 * callee, both from the relay number — neither side sees the other's.
 */
@ApiTags('calls')
@ApiBearerAuth('access-token')
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get('targets')
  @ApiOperation({
    summary: 'Who the caller can ring from a conversation or a ride',
    description:
      'Never includes a number. `available` is false, with a reason to show, when a call cannot be placed right now.',
  })
  @ApiOkResponse({ type: [CallTargetDto] })
  targets(
    @CurrentUser() userId: string,
    @Query() query: CallContextQueryDto,
  ): Promise<CallTargetDto[]> {
    return this.calls.targets(userId, query);
  }

  @Post()
  @RateLimit('callStart')
  @ApiOperation({
    summary: 'Place a relay call',
    description:
      'Your own phone rings first, from the relay number; answer it and you are put through. Progress arrives as `call.updated` on the messaging socket.',
  })
  @ApiCreatedResponse({ type: CallSessionDto })
  start(
    @CurrentUser() userId: string,
    @Body() body: StartCallDto,
  ): Promise<CallSessionDto> {
    return this.calls.start(userId, body);
  }

  @Get('my-number')
  @ApiOperation({ summary: 'The number your phone rings on when you place a call' })
  @ApiOkResponse({ type: MyNumberDto })
  myNumber(@CurrentUser() userId: string): Promise<MyNumberDto> {
    return this.calls.myNumber(userId);
  }

  @Put('my-number')
  @ApiOperation({ summary: 'Set or clear it' })
  @ApiOkResponse({ type: MyNumberDto })
  setMyNumber(
    @CurrentUser() userId: string,
    @Body() body: SetMyNumberDto,
  ): Promise<MyNumberDto> {
    return this.calls.setMyNumber(userId, body.phone);
  }

  @Get(':callId')
  @ApiOkResponse({ type: CallSessionDto })
  get(
    @CurrentUser() userId: string,
    @Param('callId', ParseUUIDPipe) callId: string,
  ): Promise<CallSessionDto> {
    return this.calls.get(userId, callId);
  }
}
