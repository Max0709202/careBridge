import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AccountDeletionService } from './account-deletion.service';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { SessionsService } from './sessions.service';
import {
  ChangePasswordDto,
  EmailOnlyDto,
  LoginDto,
  LogoutDto,
  MfaCodeDto,
  MfaEnrolmentDto,
  MfaStatusDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  SessionResponseDto,
  SessionSummaryDto,
  TokenDto,
  TokenPairDto,
} from './auth.dto';
import {
  DeletionReceiptDto,
  DeletionStatusDto,
  DeletionTokenDto,
  PublicDeletionRequestDto,
} from './account-deletion.dto';
import { DELETION_GRACE_DAYS } from '../../domain/account-deletion';
import { Public } from './auth.guard';
import { RateLimit } from '../../common/rate-limit.guard';
import {
  Ctx,
  CurrentSession,
  CurrentUser,
  RequestContext,
} from '../../common/request-context';
import { CareService } from '../care/care.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotFoundError } from '../../common/errors';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly care: CareService,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
    private readonly deletion: AccountDeletionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Registration returns the signed-in state immediately.
   *
   * That state is genuinely empty — no patients, no appointments — because a
   * new account has nothing in it. The first-run experience should be the one a
   * real user gets, not a seeded one.
   */
  @Public()
  @RateLimit('emailDispatch')
  @Post('register')
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Signs the new account in immediately and sends a verification email. Nothing is blocked on verification — locking a family out of a ride they have already booked because an email went to spam is the worse outcome — but invitations require a verified address.',
  })
  async register(
    @Body() dto: RegisterDto,
    @Ctx() ctx: RequestContext,
  ): Promise<SessionResponseDto> {
    const { userId, tokens } = await this.auth.register(dto, ctx);
    return { ...tokens, state: await this.care.snapshot(userId) };
  }

  @Public()
  @RateLimit('signIn')
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Accounts with two-factor authentication confirmed must also send `mfaCode`. The code is checked only after the password, so an attacker without the password never learns whether an account has MFA at all.',
  })
  async login(
    @Body() dto: LoginDto,
    @Ctx() ctx: RequestContext,
  ): Promise<SessionResponseDto> {
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
  @ApiOkResponse({ type: TokenPairDto })
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Single-use. Presenting one that has already been rotated revokes the whole family and forces a fresh sign-in: two parties hold tokens from one login and only one of them is legitimate.',
  })
  async refresh(
    @Body() dto: RefreshDto,
    @Ctx() ctx: RequestContext,
  ): Promise<TokenPairDto> {
    return this.auth.refresh(dto.refreshToken, ctx);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Sign out of this device, or of all of them' })
  async logout(
    @CurrentUser() userId: string,
    @Body() dto: LogoutDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.logout(userId, dto, ctx);
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Sign out everywhere',
    description:
      'Revokes every refresh token and raises the account’s token version, so access tokens already in the wild stop working on their next request rather than at their next expiry.',
  })
  async logoutAll(
    @CurrentUser() userId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.logout(userId, { allDevices: true }, ctx);
  }

  // ─── email verification ───────────────────────────────────────────────────

  @Public()
  @RateLimit('tokenGuess')
  @Post('verify-email')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The address is confirmed.' })
  @ApiOperation({ summary: 'Confirm an email address with the emailed token' })
  async verifyEmail(@Body() dto: TokenDto, @Ctx() ctx: RequestContext): Promise<void> {
    await this.auth.verifyEmail(dto.token, ctx);
  }

  @Public()
  @RateLimit('emailDispatch')
  @Post('resend-verification')
  @HttpCode(202)
  @ApiAcceptedResponse({
    description: 'Accepted, whatever the address turns out to be.',
  })
  @ApiOperation({
    summary: 'Send the verification email again',
    description:
      'Always accepted. Whether the address has an account, and whether it is already verified, are facts about a person that an unauthenticated caller does not get to read.',
  })
  async resendVerification(
    @Body() dto: EmailOnlyDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.resendVerification(dto.email, ctx);
  }

  // ─── password ─────────────────────────────────────────────────────────────

  @Public()
  @RateLimit('emailDispatch')
  @Post('password-reset')
  @HttpCode(202)
  @ApiAcceptedResponse({
    description: 'Accepted, whatever the address turns out to be.',
  })
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always accepted, whether or not the address has an account. Anything else turns this endpoint into a way to enumerate the customer list — which for this product is a list of people with a vulnerable relative.',
  })
  async requestPasswordReset(
    @Body() dto: EmailOnlyDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.requestPasswordReset(dto.email, ctx);
  }

  @Public()
  @RateLimit('tokenGuess')
  @Post('password-reset/confirm')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'The password is changed and every session revoked.',
  })
  @ApiOperation({
    summary: 'Set a new password with the emailed token',
    description:
      'Revokes every session and emails the account holder that it happened. A reset that leaves sessions alive hands an attacker who already has one a foothold the new password does not dislodge.',
  })
  async confirmPasswordReset(
    @Body() dto: ResetPasswordDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword, ctx);
  }

  @Post('password')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change the password while signed in' })
  async changePassword(
    @CurrentUser() userId: string,
    @Body() dto: ChangePasswordDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword, ctx);
  }

  // ─── sessions ─────────────────────────────────────────────────────────────

  @Get('sessions')
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: [SessionSummaryDto] })
  @ApiOperation({
    summary: 'List active sessions',
    description:
      'One row per sign-in, not per token. Tokens rotate every few minutes; the family id is stable for the life of a session, so it is what a person recognises and can act on.',
  })
  async listSessions(
    @CurrentUser() userId: string,
    @CurrentSession() familyId: string | null,
  ): Promise<SessionSummaryDto[]> {
    return this.sessions.list(userId, familyId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke one session' })
  async revokeSession(
    @CurrentUser() userId: string,
    @Param('id') familyId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.sessions.revoke(userId, familyId, ctx);
  }

  // ─── account deletion ─────────────────────────────────────────────────────

  @Get('account/deletion')
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: DeletionStatusDto })
  @ApiOperation({
    summary: 'Whether a deletion could be started, and why not if not',
    description:
      'Returns the blockers so the screen can explain itself before the person commits, rather than accepting a tap and then refusing it. It reports no pending deletion because there can be no session in which one is visible — the request signs every device out, and signing back in cancels it.',
  })
  async deletionStatus(@CurrentUser() userId: string): Promise<DeletionStatusDto> {
    const status = await this.deletion.status(userId);
    return {
      blockers: [...status.blockers],
      blockerMessages: [...status.blockerMessages],
      graceDays: DELETION_GRACE_DAYS,
    };
  }

  @Get('account/export')
  @ApiBearerAuth('access-token')
  @ApiOkResponse({
    description: 'Everything CareBridge holds about this account.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOperation({
    summary: 'Download everything we hold about this account',
    description:
      'Available on its own, not only as part of a deletion. Sign-in credentials, two-factor secrets and recovery codes are deliberately excluded — a file containing those is a credential in somebody’s inbox.',
  })
  async exportAccount(@CurrentUser() userId: string): Promise<Record<string, unknown>> {
    return this.deletion.exportFor(userId) as unknown as Record<string, unknown>;
  }

  /**
   * Apple 5.1.1(v): an app that supports account creation must support account
   * deletion from inside the app, and a support email address is explicitly not
   * sufficient.
   *
   * Schedules rather than executes, and answers with the export — this request
   * signs every device out, so it is the last moment the account holder can be
   * handed their own data.
   */
  @Delete('account')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: DeletionReceiptDto })
  @ApiOperation({
    summary: 'Delete this account',
    description:
      'Schedules deletion 30 days out, signs every device out immediately, and returns a full export. Signing in again before the date cancels it. Refused with 409 while a journey is under way, while the account is the last owner of an operator that still has drivers, or while an invoice is unpaid.',
  })
  async deleteAccount(
    @CurrentUser() userId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<DeletionReceiptDto> {
    const receipt = await this.deletion.request(userId, ctx);
    return {
      scheduledFor: receipt.scheduledFor.toISOString(),
      graceDays: receipt.graceDays,
      alreadyPending: receipt.alreadyPending,
      data: receipt.data as unknown as Record<string, unknown>,
    };
  }

  /**
   * Google Play requires deletion to be requestable at a publicly reachable
   * URL, without installing the app — so whoever reaches this is by definition
   * not signed in, and the emailed link is what proves they hold the address.
   */
  @Public()
  @RateLimit('emailDispatch')
  @Post('account/deletion-request')
  @HttpCode(202)
  @ApiAcceptedResponse({
    description: 'Accepted, whatever the address turns out to be.',
  })
  @ApiOperation({
    summary: 'Request a deletion link by email, without signing in',
    description:
      'Always accepted. Anything else turns this endpoint into a way to enumerate the customer list — which for this product is a list of people with a vulnerable relative.',
  })
  async requestDeletionByEmail(
    @Body() dto: PublicDeletionRequestDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.deletion.requestByEmail(dto.email, ctx);
  }

  @Public()
  @RateLimit('tokenGuess')
  @Post('account/deletion-request/confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: DeletionReceiptDto })
  @ApiOperation({
    summary: 'Confirm a deletion requested from the public page',
    description:
      'Spends the emailed token and schedules the deletion on the same terms as the in-app path, blockers included: the public route does not get to skip the rule about somebody being in a car.',
  })
  async confirmDeletionByToken(
    @Body() dto: DeletionTokenDto,
    @Ctx() ctx: RequestContext,
  ): Promise<DeletionReceiptDto> {
    const receipt = await this.deletion.confirmByToken(dto.token, ctx);
    return {
      scheduledFor: receipt.scheduledFor.toISOString(),
      graceDays: receipt.graceDays,
      alreadyPending: receipt.alreadyPending,
      data: receipt.data as unknown as Record<string, unknown>,
    };
  }

  // ─── multi-factor authentication ──────────────────────────────────────────

  @Get('mfa')
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: MfaStatusDto })
  @ApiOperation({ summary: 'Two-factor authentication status' })
  async mfaStatus(@CurrentUser() userId: string): Promise<MfaStatusDto> {
    return this.mfa.status(userId);
  }

  @Post('mfa/enrol')
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: MfaEnrolmentDto })
  @ApiOperation({
    summary: 'Begin two-factor enrolment',
    description:
      'Returns the QR payload and the recovery codes, once. Enrolment is not active until a code is confirmed — marking it active here would lock out anyone whose authenticator app failed to scan the code, with no second factor to recover with.',
  })
  async beginMfaEnrolment(
    @CurrentUser() userId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<MfaEnrolmentDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) throw new NotFoundError();

    return this.mfa.beginEnrolment(userId, user.email, ctx);
  }

  @RateLimit('tokenGuess')
  @Post('mfa/confirm')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Two-factor authentication is now active.' })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Confirm enrolment with one generated code' })
  async confirmMfa(
    @CurrentUser() userId: string,
    @Body() dto: MfaCodeDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.mfa.confirmEnrolment(userId, dto.code, ctx);
  }

  @Delete('mfa')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Turn two-factor authentication off' })
  async disableMfa(
    @CurrentUser() userId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.mfa.disable(userId, ctx);
  }
}
