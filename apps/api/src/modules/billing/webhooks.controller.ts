import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  PAYMENTS,
  type PaymentsPort,
  type ProcessorWebhookEvent,
} from '../../infrastructure/payments/payments.port';
import { WebhookSignatureError } from '../../infrastructure/payments/webhook-signature';
import { ValidationError } from '../../common/errors';
import { Public } from '../auth/auth.guard';
import { InvoicesService } from './invoices.service';

/**
 * Where the processor tells us what happened.
 *
 * Four properties make this endpoint safe, and every one of them is load-
 * bearing:
 *
 *   1. **The signature is verified against the raw bytes.** Without it this is
 *      an unauthenticated POST that marks any invoice paid, and its URL is not
 *      a secret — it is in the processor's dashboard and in our logs.
 *   2. **Every event id is claimed exactly once**, by a unique constraint
 *      rather than a check-then-write. Redelivery is documented processor
 *      behaviour, not failure, and two workers racing the same redelivery must
 *      not both pass a check.
 *   3. **An unrecognised event is a 200.** A processor retries non-2xx for
 *      days; answering 500 to an event type we do not handle turns a shrug
 *      into a retry storm and eventually into a disabled webhook — which
 *      silently stops the events we *do* handle.
 *   4. **An event for an object we do not know is recorded, not dropped**, so
 *      "the money moved and we never saw it" leaves a trace.
 *
 * Excluded from the OpenAPI document: it is not part of the client contract,
 * and generating a Dart method for it would offer the app a way to call it.
 */
@ApiExcludeController()
@Controller('billing/webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
    @Inject(PAYMENTS) private readonly payments: PaymentsPort,
  ) {}

  @Post('payments')
  @Public()
  @HttpCode(200)
  async payments_(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    // `rawBody` is populated by `NestFactory.create(..., { rawBody: true })`.
    // A signature is over the exact bytes sent, so a body that has been parsed
    // and re-serialised will not verify — the fallback below exists only so a
    // misconfiguration fails as a rejected signature rather than a crash.
    const raw = request.rawBody ?? Buffer.from('');

    const event = this.verify(raw, signature);

    // The claim. A duplicate delivery loses the insert and stops here, which
    // is the whole defence against a redelivered `succeeded` crediting an
    // account twice.
    const claimed = await this.claim(event);
    if (!claimed) return { received: true };

    const outcome = await this.handle(event);

    await this.prisma.processorEvent.update({
      where: { externalEventId: event.id },
      data: { processedAt: new Date(), skippedReason: outcome },
    });

    return { received: true };
  }

  /**
   * Verifies, and turns a failure into a refusal rather than a crash.
   *
   * A bad signature is a *client* error — somebody sent us something we will
   * not act on — so it is a 400. Left to reach the error filter as an unknown
   * exception it would be a 500, which tells the processor to retry, so a
   * genuine misconfiguration would arrive again every few minutes for days.
   *
   * The reason is logged at `warn` and not returned: an attacker probing the
   * endpoint should not be told whether their timestamp or their digest was
   * the part that failed.
   */
  private verify(raw: Buffer, signature: string | undefined): ProcessorWebhookEvent {
    try {
      return this.payments.verifyWebhook(raw, signature);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        this.logger.warn(`Rejected an unverified payment webhook: ${error.message}`);
        throw new ValidationError('That callback could not be verified.');
      }
      throw error;
    }
  }

  private async claim(event: ProcessorWebhookEvent): Promise<boolean> {
    try {
      await this.prisma.processorEvent.create({
        data: { externalEventId: event.id, type: event.type },
      });
      return true;
    } catch {
      // The unique constraint. Any other failure would also land here, and
      // treating it as "already handled" is the safe reading: the alternative
      // is processing an event twice.
      this.logger.debug(`Processor event ${event.id} already handled`);
      return false;
    }
  }

  /** Returns null when acted on, or a reason it was not. */
  private async handle(event: ProcessorWebhookEvent): Promise<string | null> {
    const now = new Date();

    if (!event.externalPaymentId) {
      return 'no payment reference on the event';
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'charge.succeeded': {
        const result = await this.invoices.settleFromWebhook({
          externalPaymentId: event.externalPaymentId,
          succeeded: true,
          failureCode: null,
          failureMessage: null,
          now,
        });
        return result === 'settled' ? null : result;
      }

      case 'payment_intent.payment_failed':
      case 'charge.failed': {
        const result = await this.invoices.settleFromWebhook({
          externalPaymentId: event.externalPaymentId,
          succeeded: false,
          failureCode: event.failureCode,
          failureMessage: event.failureMessage,
          now,
        });
        return result === 'settled' ? null : result;
      }

      case 'charge.refunded': {
        const result = await this.invoices.recordRefund({
          externalPaymentId: event.externalPaymentId,
          amountCents: event.amountCents ?? 0,
          now,
        });
        return result === 'recorded' ? null : result;
      }

      default:
        // Answered 200. See the note at the top: a retry storm over an event
        // we do not care about eventually disables the endpoint entirely.
        return `unhandled event type ${event.type}`;
    }
  }
}
