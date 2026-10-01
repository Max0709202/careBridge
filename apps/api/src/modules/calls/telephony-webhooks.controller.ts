import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../auth/auth.guard';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import {
  TELEPHONY,
  type CallLeg,
  type TelephonyPort,
  type WebhookReply,
} from '../../infrastructure/telephony/telephony.port';
import { CallsService } from './calls.service';

const LEGS: readonly CallLeg[] = ['caller', 'callee', 'dial'];

/**
 * The provider's side of a relay call. Public, because the provider has no
 * token — and so **every request is signature-checked** before anything is
 * read from it. An unsigned request is answered with an empty 403 and changes
 * nothing; the session id in the query is not a capability on its own.
 */
@ApiExcludeController()
@Controller('telephony')
export class TelephonyWebhooksController {
  private readonly logger = new Logger(TelephonyWebhooksController.name);

  constructor(
    private readonly calls: CallsService,
    @Inject(TELEPHONY) private readonly telephony: TelephonyPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The caller answered: dial the callee, whose number is resolved now. */
  @Post('voice/bridge')
  @Public()
  async bridge(
    @Req() request: Request,
    @Res() response: Response,
    @Query('session') session: string | undefined,
    @Body() params: Record<string, string>,
    @Headers('x-twilio-signature') signature: string | undefined,
  ): Promise<void> {
    if (!this.verified(request, params, signature) || !session)
      return this.forbid(response);
    const callee = await this.calls.calleeNumberFor(session);
    this.reply(
      response,
      this.telephony.bridgeReply(session, callee, this.config.TELEPHONY_RELAY_NUMBER),
    );
  }

  /** The bridged leg is over; its outcome is the call's outcome. */
  @Post('voice/dial-result')
  @Public()
  async dialResult(
    @Req() request: Request,
    @Res() response: Response,
    @Query('session') session: string | undefined,
    @Body() params: Record<string, string>,
    @Headers('x-twilio-signature') signature: string | undefined,
  ): Promise<void> {
    if (!this.verified(request, params, signature) || !session)
      return this.forbid(response);
    const update = this.telephony.readStatus(session, 'dial', params);
    if (update) await this.calls.apply(update);
    this.reply(response, this.telephony.hangupReply());
  }

  @Post('status')
  @Public()
  @HttpCode(204)
  async status(
    @Req() request: Request,
    @Res() response: Response,
    @Query('session') session: string | undefined,
    @Query('leg') leg: string | undefined,
    @Body() params: Record<string, string>,
    @Headers('x-twilio-signature') signature: string | undefined,
  ): Promise<void> {
    if (
      !this.verified(request, params, signature) ||
      !session ||
      !LEGS.includes(leg as CallLeg)
    ) {
      return this.forbid(response);
    }
    const update = this.telephony.readStatus(session, leg as CallLeg, params);
    if (update) await this.calls.apply(update);
    response.status(204).end();
  }

  /** Someone rang the relay number. */
  @Post('voice/inbound')
  @Public()
  async inbound(
    @Req() request: Request,
    @Res() response: Response,
    @Body() params: Record<string, string>,
    @Headers('x-twilio-signature') signature: string | undefined,
  ): Promise<void> {
    if (!this.verified(request, params, signature)) return this.forbid(response);
    const forwardTo = await this.calls.forwardInbound(
      this.telephony.inboundFrom(params),
    );
    this.reply(
      response,
      this.telephony.inboundReply(forwardTo, this.config.TELEPHONY_RELAY_NUMBER),
    );
  }

  private verified(
    request: Request,
    params: Record<string, string>,
    signature: string | undefined,
  ): boolean {
    // `originalUrl` is `/api/v1/telephony/…?…`; the adapter prefixes the
    // configured public base, which already ends in `/api/v1`.
    const pathAndQuery = request.originalUrl.replace(/^\/api\/v1/, '');
    const ok = this.telephony.verifyWebhook({
      pathAndQuery,
      params: stringParams(params),
      signature,
    });
    if (!ok) this.logger.warn('Telephony webhook refused: bad or missing signature');
    return ok;
  }

  private forbid(response: Response): void {
    response.status(403).end();
  }

  private reply(response: Response, reply: WebhookReply): void {
    response.status(200).type(reply.contentType).send(reply.body);
  }
}

/** Form bodies can carry arrays for repeated keys; the signature scheme uses the first. */
function stringParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
  }
  return out;
}
