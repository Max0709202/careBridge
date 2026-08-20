import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type { BillingInterval } from '@prisma/client';

import { Ctx, CurrentUser, RequestContext } from '../../common/request-context';
import { Idempotent } from '../../common/idempotency.interceptor';
import { BillingService } from './billing.service';
import { OrganizationsService } from '../organizations/organizations.service';
import {
  BillingAccountDto,
  InvoiceDto,
  OrganizationDto,
  OrganizationSeatsDto,
  PaymentMethodDto,
  SubscriptionPlanDto,
  SubscriptionQuoteDto,
} from './billing.dto';
import { ChangeIntervalDto, SubscribeDto } from './dto/subscribe.dto';
import { AttachPaymentMethodDto } from './dto/payment-method.dto';

/**
 * Two payers, one set of endpoints, split by whose money it is.
 *
 * `/billing/*` is the household the caller pays for. `/organizations/:id/*` is
 * an operator they hold a role in. They are separate paths rather than one
 * endpoint with a `payer` parameter because the *authorisation* is different —
 * a family account is answered by owning it, an operator account by a
 * membership with a role — and collapsing them would put that branch inside a
 * handler instead of at the door.
 */
@ApiTags('billing')
@ApiBearerAuth('access-token')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @ApiOperation({
    summary: 'The plan catalogue',
    description:
      'Plans are rows, resolved server-side. The app renders what it is told — a price change or a new tier is an insert, not a release.',
  })
  @ApiQuery({
    name: 'payer',
    enum: ['family', 'dispatchOrganization'],
    required: false,
  })
  @ApiOkResponse({ type: [SubscriptionPlanDto] })
  plans(@Query('payer') payer?: string): Promise<SubscriptionPlanDto[]> {
    return this.billing.plans(
      payer === 'dispatchOrganization' ? 'dispatchOrganization' : 'family',
    );
  }

  @Get('account')
  @ApiOperation({ summary: "The caller's household subscription" })
  @ApiOkResponse({ type: BillingAccountDto })
  account(@CurrentUser() userId: string): Promise<BillingAccountDto | null> {
    return this.billing.familyBilling(userId);
  }

  @Post('subscribe')
  @Idempotent()
  @ApiOperation({
    summary: 'Start a household subscription',
    description:
      'Refused if one is already live — changing plan is `change-interval`, and anything else is two intentions sharing an endpoint.',
  })
  @ApiOkResponse({ type: BillingAccountDto })
  subscribe(
    @CurrentUser() userId: string,
    @Body() body: SubscribeDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BillingAccountDto> {
    return this.billing.subscribeFamily(
      userId,
      { planCode: body.planCode, interval: body.interval as BillingInterval },
      ctx,
    );
  }

  @Post('change-interval')
  @ApiOperation({
    summary: 'Move between monthly and annual',
    description:
      'The unused remainder of the current period is credited and a fresh period starts today. Annual → monthly leaves a credit carried against renewals, not a refund.',
  })
  @ApiOkResponse({ type: BillingAccountDto })
  changeInterval(
    @CurrentUser() userId: string,
    @Body() body: ChangeIntervalDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BillingAccountDto> {
    return this.billing.changeInterval(
      userId,
      {},
      body.interval as BillingInterval,
      ctx,
    );
  }

  @Get('invoices')
  @ApiOperation({
    summary: 'What this household has been billed',
    description:
      'Newest first. Line items are read back from the invoice, not recomputed — a superseded plan must not reprint last March at this March’s prices.',
  })
  @ApiOkResponse({ type: [InvoiceDto] })
  invoices(@CurrentUser() userId: string): Promise<InvoiceDto[]> {
    return this.billing.invoices(userId, {});
  }

  @Post('payment-method')
  @Idempotent()
  @ApiOperation({
    summary: 'Put a card on file',
    description:
      'Takes a token the client obtained directly from the processor. No endpoint in this system accepts a card number — see ADR-0006.',
  })
  @ApiOkResponse({ type: PaymentMethodDto })
  attachPaymentMethod(
    @CurrentUser() userId: string,
    @Body() body: AttachPaymentMethodDto,
    @Ctx() ctx: RequestContext,
  ): Promise<PaymentMethodDto> {
    return this.billing.attachPaymentMethod(userId, {}, body.token, ctx);
  }

  @Delete('payment-method/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Take a card off file',
    description:
      'The row is kept and marked detached, so a payment made months ago still names the card that made it. Removing the last card is allowed.',
  })
  @ApiNoContentResponse()
  detachPaymentMethod(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    return this.billing.detachPaymentMethod(userId, {}, id, ctx);
  }

  @Post('invoices/:id/pay')
  @ApiOperation({
    summary: 'Charge an open invoice now',
    description:
      'For the moment after a declined card is replaced: waiting a day for the scheduled retry, while the screen still says the payment failed, reads as the update not having worked.',
  })
  @ApiOkResponse({ type: InvoiceDto })
  payInvoice(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceDto> {
    return this.billing.payInvoice(userId, {}, id);
  }

  @Post('cancel')
  @ApiOperation({
    summary: 'Cancel at the end of the paid period',
    description:
      'Not a refund and not an immediate switch-off: a family part-way through a booked month keeps live tracking for the rides they have already arranged.',
  })
  @ApiOkResponse({ type: BillingAccountDto })
  cancel(
    @CurrentUser() userId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<BillingAccountDto> {
    return this.billing.cancel(userId, {}, ctx);
  }
}

@ApiTags('organizations')
@ApiBearerAuth('access-token')
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly billing: BillingService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Organisations the caller belongs to' })
  @ApiOkResponse({ type: [OrganizationDto] })
  async mine(@CurrentUser() userId: string): Promise<OrganizationDto[]> {
    const memberships = await this.organizations.membershipsFor(userId);
    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      kind: membership.organization.kind,
      timeZone: membership.organization.timeZone,
      role: membership.role,
    }));
  }

  @Get(':id/billing')
  @ApiOperation({ summary: "An operator's subscription" })
  @ApiOkResponse({ type: BillingAccountDto })
  organizationBilling(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillingAccountDto> {
    return this.billing.organizationBilling(userId, id);
  }

  @Post(':id/billing/subscribe')
  @Idempotent()
  @ApiOperation({
    summary: 'Start an operator subscription',
    description:
      'Priced at the drivers actually on the road — an operator cannot subscribe at five seats and run twenty.',
  })
  @ApiOkResponse({ type: BillingAccountDto })
  subscribeOrganization(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubscribeDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BillingAccountDto> {
    return this.billing.subscribeOrganization(
      userId,
      id,
      { planCode: body.planCode, interval: body.interval as BillingInterval },
      ctx,
    );
  }

  @Post(':id/billing/change-interval')
  @ApiOperation({ summary: 'Move an operator between monthly and annual' })
  @ApiOkResponse({ type: BillingAccountDto })
  changeOrganizationInterval(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeIntervalDto,
    @Ctx() ctx: RequestContext,
  ): Promise<BillingAccountDto> {
    return this.billing.changeInterval(
      userId,
      { organizationId: id },
      body.interval as BillingInterval,
      ctx,
    );
  }

  @Post(':id/billing/cancel')
  @ApiOperation({ summary: 'Cancel an operator subscription at period end' })
  @ApiOkResponse({ type: BillingAccountDto })
  cancelOrganization(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<BillingAccountDto> {
    return this.billing.cancel(userId, { organizationId: id }, ctx);
  }

  @Get(':id/billing/invoices')
  @ApiOperation({ summary: 'What this operator has been billed' })
  @ApiOkResponse({ type: [InvoiceDto] })
  organizationInvoices(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoiceDto[]> {
    return this.billing.invoices(userId, { organizationId: id });
  }

  @Post(':id/billing/payment-method')
  @Idempotent()
  @ApiOperation({ summary: "Put a card on an operator's account" })
  @ApiOkResponse({ type: PaymentMethodDto })
  attachOrganizationPaymentMethod(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttachPaymentMethodDto,
    @Ctx() ctx: RequestContext,
  ): Promise<PaymentMethodDto> {
    return this.billing.attachPaymentMethod(
      userId,
      { organizationId: id },
      body.token,
      ctx,
    );
  }

  @Delete(':id/billing/payment-method/:paymentMethodId')
  @HttpCode(204)
  @ApiOperation({ summary: "Take a card off an operator's account" })
  @ApiNoContentResponse()
  detachOrganizationPaymentMethod(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentMethodId', ParseUUIDPipe) paymentMethodId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    return this.billing.detachPaymentMethod(
      userId,
      { organizationId: id },
      paymentMethodId,
      ctx,
    );
  }

  @Post(':id/billing/invoices/:invoiceId/pay')
  @ApiOperation({ summary: "Charge an operator's open invoice now" })
  @ApiOkResponse({ type: InvoiceDto })
  payOrganizationInvoice(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ): Promise<InvoiceDto> {
    return this.billing.payInvoice(userId, { organizationId: id }, invoiceId);
  }

  @Get(':id/seats')
  @ApiOperation({
    summary: 'Drivers, seats and the ledger behind them',
    description:
      'The audit trail an invoice line is answerable from: without it, "why were we billed for eleven drivers" can only be answered from a driver table that has since changed.',
  })
  @ApiOkResponse({ type: OrganizationSeatsDto })
  seats(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationSeatsDto> {
    return this.billing.organizationSeats(userId, id);
  }

  @Get(':id/seats/quote')
  @ApiOperation({ summary: 'What a given driver count would cost' })
  @ApiQuery({ name: 'planCode', required: true })
  @ApiQuery({ name: 'interval', enum: ['monthly', 'annual'], required: true })
  @ApiQuery({ name: 'seats', required: true, type: Number })
  @ApiOkResponse({ type: SubscriptionQuoteDto })
  async quote(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('planCode') planCode: string,
    @Query('interval') interval: string,
    @Query('seats') seats: string,
  ): Promise<SubscriptionQuoteDto> {
    await this.organizations.requireMembership(userId, id, [
      'owner',
      'admin',
      'dispatcher',
    ]);
    return this.billing.quoteSeats(
      planCode,
      interval === 'annual' ? 'annual' : 'monthly',
      Number.parseInt(seats, 10) || 0,
    );
  }
}
