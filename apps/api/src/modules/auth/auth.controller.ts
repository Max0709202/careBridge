import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshDto, RegisterDto } from './auth.dto';
import { Public } from './auth.guard';
import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { CareService } from '../care/care.service';
import type { CareStateDto } from '../care/care.dto';

interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  state: CareStateDto;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly care: CareService,
  ) {}

  /**
   * Registration returns the signed-in state immediately.
   *
   * That state is genuinely empty — no patients, no appointments — because a
   * new account has nothing in it. The first-run experience should be the one a
   * real user gets, not a seeded one.
   */
  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Ctx() ctx: RequestContext,
  ): Promise<SessionResponse> {
    const { userId, tokens } = await this.auth.register(dto, ctx);
    return { ...tokens, state: await this.care.snapshot(userId) };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ctx() ctx: RequestContext,
  ): Promise<SessionResponse> {
    const { userId, tokens } = await this.auth.login(dto, ctx);
    return { ...tokens, state: await this.care.snapshot(userId) };
  }

  /**
   * Public because the access token is expected to be expired by the time a
   * client calls this — the refresh token in the body *is* the credential.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Ctx() ctx: RequestContext) {
    return this.auth.refresh(dto.refreshToken, ctx);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() userId: string,
    @Body() dto: LogoutDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.logout(userId, dto, ctx);
  }
}
