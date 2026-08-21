import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { AdminService } from './admin.service';
import { PlatformRoleGuard, RequiresPlatform } from './platform-role.guard';
import {
  AuditPageDto,
  FeatureFlagDto,
  PlatformStatsDto,
  RefundableInvoiceDto,
} from './admin.dto';
import {
  AuditQueryDto,
  IssueRefundDto,
  SetFeatureFlagDto,
} from './dto/admin.request.dto';

/**
 * CareBridge's own staff surfaces.
 *
 * Every route requires a platform role **and a confirmed second factor** — see
 * `PlatformRoleGuard`. The split between `support` and `admin` is the whole
 * authorisation model here: support reads, admin writes. An account that can
 * read the audit log across every organisation is already sensitive; one that
 * can move money out of the business is the most valuable password in the
 * system, and the two should not be the same account by default.
 *
 * A caller without standing gets the same 404 every other refused lookup
 * returns, so probing `/admin` cannot map out the administration surface.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('audit')
  @RequiresPlatform('support')
  @ApiOperation({
    summary: 'The audit log, filtered and paged',
    description:
      'Keyset paged. An offset over a table appended to on every authenticated action would skip rows between pages — and quietly omitting rows is the one failure a log like this cannot have.',
  })
  @ApiOkResponse({ type: AuditPageDto })
  auditLog(@Query() query: AuditQueryDto): Promise<AuditPageDto> {
    return this.admin.auditLog(query);
  }

  @Get('stats')
  @RequiresPlatform('support')
  @ApiOperation({
    summary: 'The operational dashboard',
    description:
      'Each number implies an action rather than being interesting. “Stale tracking now” is a list of telephone calls; “drivers with expiring documents” is a list of drivers who come off the road unless somebody chases them.',
  })
  @ApiOkResponse({ type: PlatformStatsDto })
  stats(): Promise<PlatformStatsDto> {
    return this.admin.stats(new Date());
  }

  @Get('flags')
  @RequiresPlatform('support')
  @ApiOperation({ summary: 'Every feature flag and how far it is rolled out' })
  @ApiOkResponse({ type: [FeatureFlagDto] })
  flags(): Promise<FeatureFlagDto[]> {
    return this.admin.flags();
  }

  @Put('flags/:key')
  @RequiresPlatform('admin')
  @ApiOperation({
    summary: 'Create or update a flag',
    description:
      'Narrowing a rollout needs `confirmNarrowing`: it takes a feature away from people who already have it, which reads to them as a bug rather than as a decision.',
  })
  @ApiOkResponse({ type: [FeatureFlagDto] })
  setFlag(
    @CurrentUser() userId: string,
    @Param('key') key: string,
    @Body() body: SetFeatureFlagDto,
    @Ctx() ctx: RequestContext,
  ): Promise<FeatureFlagDto[]> {
    return this.admin.setFlag(key, body, userId, ctx);
  }

  @Get('invoices/:invoiceId/refunds')
  @RequiresPlatform('admin')
  @ApiOperation({ summary: 'What may still be refunded, and what already was' })
  @ApiOkResponse({ type: RefundableInvoiceDto })
  refundable(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ): Promise<RefundableInvoiceDto> {
    return this.admin.refundableInvoice(invoiceId);
  }

  @Post('invoices/:invoiceId/refunds')
  @RequiresPlatform('admin')
  @ApiOperation({
    summary: 'Send money back',
    description:
      'The row is written before the processor is called, in the same shape the collection path uses: a refund that succeeded externally and failed to record here would be money that left the business with nothing to explain it.',
  })
  @ApiCreatedResponse({ type: RefundableInvoiceDto })
  issueRefund(
    @CurrentUser() userId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() body: IssueRefundDto,
    @Ctx() ctx: RequestContext,
  ): Promise<RefundableInvoiceDto> {
    return this.admin.issueRefund(invoiceId, body, userId, ctx);
  }
}
