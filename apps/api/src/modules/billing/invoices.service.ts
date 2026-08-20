import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Invoice, InvoiceReason, Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MAIL, type MailPort } from '../../infrastructure/mail/mail.port';
import {
  PAYMENTS,
  type PaymentsPort,
} from '../../infrastructure/payments/payments.port';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { AuditService } from '../audit/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { Money } from '../../domain/money';
import { graceEndsAt } from '../../domain/billing';
import {
  classifyDecline,
  isExhausted,
  nextAttemptAt,
  type DeclineKind,
} from '../../domain/dunning';
import type { SubscriptionQuote } from '../../domain/subscription-pricing';
import { toEntitlementState, type SubscriptionRow } from './billing.mapper';
import {
  paymentFailedEmail,
  paymentReceiptEmail,
  subscriptionExpiredEmail,
} from './billing-mail';

type Db = PrismaService | Prisma.TransactionClient;

/** No card on file is a collection failure, not a crash. It dunns like any other. */
const NO_PAYMENT_METHOD = 'no_payment_method';

/**
 * Issuing invoices and collecting against them.
 *
 * The shape of this service is dictated by one property: **a charge is not
 * transactional with the database it is recorded in.** Money moves at the
 * processor; a row moves here; and a crash between them is not a hypothetical
 * but the ordinary consequence of a deploy landing at the wrong second.
 *
 * So collection is deliberately three commits, not one:
 *
 *   1. the attempt is *claimed* on the invoice, which is what stops two
 *      sweeps charging the same invoice at the same moment;
 *   2. a `Payment` row is written **before** the processor is called, so a
 *      process that dies mid-call leaves evidence that an attempt was made and
 *      an idempotency key that makes retrying it safe;
 *   3. the outcome is recorded after.
 *
 * The tempting single transaction — open one, charge, write the result, commit
 * — is wrong in the way that costs a customer money: the transaction can roll
 * back after the processor has taken the funds, and the next sweep, seeing no
 * record, charges again.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENTS) private readonly payments: PaymentsPort,
    @Inject(MAIL) private readonly mail: MailPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── issuing ──────────────────────────────────────────────────────────────

  /**
   * Writes an invoice for an amount already quoted.
   *
   * Runs inside the caller's transaction, because an invoice for a period that
   * was rolled back is a bill for nothing. Carried credit is spent here rather
   * than at collection: the amount on the invoice is the amount owed, and an
   * invoice whose total is not what will be charged is unreadable to the
   * person holding it.
   */
  async issue(input: {
    db: Db;
    billingAccountId: string;
    subscriptionId: string | null;
    periodId: string | null;
    reason: InvoiceReason;
    quote: SubscriptionQuote;
    /**
     * Credit to spend against this invoice.
     *
     * `fromCarriedBalance` distinguishes the two kinds, and they must not be
     * confused. Carried credit is a *stored balance* on the subscription and
     * spending it has to decrement that balance, or it is spent again next
     * month. Proration credit — the unused remainder of a period being
     * replaced — was never stored anywhere, and decrementing the balance by it
     * would silently take money the payer still has.
     */
    credit?: { cents: number; fromCarriedBalance: boolean };
    now: Date;
  }): Promise<Invoice> {
    const { db, billingAccountId, subscriptionId, periodId, reason, quote, now } =
      input;

    const subtotal = quote.total;
    const offered = Math.max(0, input.credit?.cents ?? 0);
    const applied = Math.min(offered, subtotal.cents);
    const total = subtotal.cents - applied;

    const invoice = await db.invoice.create({
      data: {
        billingAccountId,
        subscriptionId,
        periodId,
        reason,
        status: total === 0 ? 'paid' : 'open',
        subtotalCents: subtotal.cents,
        creditAppliedCents: applied,
        totalCents: total,
        // An invoice fully covered by credit is settled on the spot. Sending it
        // to the processor for zero is a charge no processor accepts and a
        // decline this system would then dun somebody over. `amountPaidCents`
        // stays 0 because no money moved — the credit is recorded in its own
        // column, and adding it here would double-count it in every revenue
        // sum that reads what was actually collected.
        amountPaidCents: 0,
        paidAt: total === 0 ? now : null,
        lines: quote.lines.map((line) => ({
          label: line.label,
          quantity: line.quantity,
          unitPriceCents: line.unitPrice.cents,
          amountCents: line.amount.cents,
        })),
        dueAt: new Date(now.getTime() + this.config.INVOICE_DUE_HOURS * 3_600_000),
      },
    });

    if (applied > 0 && subscriptionId && input.credit?.fromCarriedBalance) {
      await db.subscription.update({
        where: { id: subscriptionId },
        data: { carriedCreditCents: { decrement: applied } },
      });
    }

    return invoice;
  }

  // ─── collecting ───────────────────────────────────────────────────────────

  /**
   * Attempts one charge against an open invoice.
   *
   * Returns the invoice as it stands afterwards, or null when another worker
   * claimed the attempt first — which is a normal outcome under two instances,
   * not an error.
   */
  async collect(invoiceId: string, now: Date): Promise<Invoice | null> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundError();
    if (invoice.status !== 'open') return invoice;
    if (invoice.totalCents === 0) return invoice;

    // Claim. Guarded on the attempt count we read, so of two workers reaching
    // here together exactly one proceeds — the other's update matches no row.
    const claimed = await this.prisma.invoice.updateMany({
      where: { id: invoice.id, status: 'open', attemptCount: invoice.attemptCount },
      data: { attemptCount: invoice.attemptCount + 1, nextAttemptAt: null },
    });
    if (claimed.count === 0) return null;

    const attempt = invoice.attemptCount + 1;

    const account = await this.prisma.billingAccount.findUnique({
      where: { id: invoice.billingAccountId },
    });
    if (!account) throw new NotFoundError();

    const card = await this.prisma.paymentMethod.findFirst({
      where: { billingAccountId: account.id, isDefault: true, detachedAt: null },
    });

    // Written before the processor is called. If this process dies during the
    // call, the row is the evidence that it happened and the key is what makes
    // the retry safe.
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        billingAccountId: account.id,
        paymentMethodId: card?.id ?? null,
        attempt,
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        status: 'pending',
        idempotencyKey: `inv:${invoice.id}:attempt:${attempt}`,
      },
    });

    if (!card) {
      return this.recordFailure(invoice, payment.id, {
        code: NO_PAYMENT_METHOD,
        message: 'There is no card on this account.',
        attempt,
        now,
      });
    }

    const customerRef = await this.customerRefFor(account.id, account.billingEmail);

    let outcome;
    try {
      outcome = await this.payments.charge({
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        customerRef,
        paymentMethodRef: card.externalId,
        idempotencyKey: payment.idempotencyKey,
        description: `CareBridge ${invoice.number}`,
      });
    } catch (error) {
      // Transport failed, so we do not know whether money moved. The payment
      // stays `pending` and the invoice stays open with no scheduled retry:
      // the webhook settles it, and a sweep that guessed either way would
      // either double-charge or write off a paid invoice.
      this.logger.error(
        `Charge for ${invoice.number} could not be completed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return this.prisma.invoice.findUnique({ where: { id: invoice.id } });
    }

    if (outcome.status === 'pending') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { externalPaymentId: outcome.externalPaymentId },
      });
      return this.prisma.invoice.findUnique({ where: { id: invoice.id } });
    }

    if (outcome.status === 'succeeded') {
      return this.recordSuccess(invoice, payment.id, outcome.externalPaymentId, now);
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { externalPaymentId: outcome.externalPaymentId },
    });

    return this.recordFailure(invoice, payment.id, {
      code: outcome.failureCode,
      message: outcome.failureMessage,
      attempt,
      now,
    });
  }

  /**
   * The processor's customer reference, created on first use.
   *
   * Public because attaching a card needs one too, and a second implementation
   * of "get or create the customer" would eventually create a second customer
   * for one account — which splits their payment methods across two records
   * neither of which has all of them.
   */
  async customerReference(accountId: string, email: string): Promise<string> {
    return this.customerRefFor(accountId, email);
  }

  /** Binds a processor token to a customer. Never sees a card number. */
  attachCard(customerRef: string, token: string) {
    return this.payments.attachPaymentMethod({ customerRef, token });
  }

  detachCard(externalId: string): Promise<void> {
    return this.payments.detachPaymentMethod(externalId);
  }

  private async customerRefFor(accountId: string, email: string): Promise<string> {
    const account = await this.prisma.billingAccount.findUniqueOrThrow({
      where: { id: accountId },
    });

    const ref = await this.payments.ensureCustomer({
      accountId,
      email,
      existingRef: account.externalCustomerId,
    });

    if (ref !== account.externalCustomerId) {
      await this.prisma.billingAccount.update({
        where: { id: accountId },
        data: { externalCustomerId: ref },
      });
    }
    return ref;
  }

  // ─── outcomes ─────────────────────────────────────────────────────────────

  /**
   * Marks an invoice paid and, where it was one, brings the subscription back.
   *
   * Idempotent on the invoice's status, because this is reachable both from a
   * charge returning success and from a webhook arriving afterwards — and both
   * happening is the normal case, not the exceptional one.
   */
  async recordSuccess(
    invoice: Invoice,
    paymentId: string,
    externalPaymentId: string | null,
    now: Date,
  ): Promise<Invoice> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'succeeded',
          externalPaymentId,
          settledAt: now,
          failureCode: null,
          failureMessage: null,
        },
      });

      const settled = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'paid',
          paidAt: now,
          amountPaidCents: invoice.totalCents,
          nextAttemptAt: null,
          lastFailureCode: null,
        },
      });

      if (invoice.subscriptionId) {
        const subscription = await tx.subscription.findUnique({
          where: { id: invoice.subscriptionId },
        });

        // Only `pastDue` recovers here. A `pendingCancellation` that pays its
        // final period is still cancelling, and reviving it would be the
        // system overriding a decision its owner already made.
        if (subscription && subscription.status === 'pastDue') {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'active',
              pastDueSince: null,
              version: { increment: 1 },
            },
          });
        }
      }

      await this.audit.record(
        {
          actorUserId: null,
          action: 'billing.payment_succeeded',
          entityType: 'Invoice',
          entityId: invoice.id,
          changedFields: ['status', 'amountPaidCents', 'paidAt'],
        },
        tx,
      );

      return settled;
    });

    await this.sendReceipt(updated);
    return updated;
  }

  /**
   * Records a decline, schedules the next attempt and moves the subscription
   * into its grace window.
   *
   * The subscription goes `pastDue` on the **first** failure, not the last.
   * That is what starts the grace clock, and the grace clock is what keeps the
   * map on while this is sorted out.
   */
  async recordFailure(
    invoice: Invoice,
    paymentId: string,
    failure: { code: string; message: string; attempt: number; now: Date },
  ): Promise<Invoice> {
    const { code, message, attempt, now } = failure;

    const decline: DeclineKind = classifyDecline(code);
    const firstFailedAt = invoice.firstFailedAt ?? now;

    // The attempt number comes from the caller, **not** from `invoice`.
    //
    // `invoice` is the snapshot read before the attempt was claimed, so its
    // `attemptCount` is one behind — deriving the number from it pins every
    // failure at attempt one, and `nextAttemptAt` then returns the first
    // offset forever. The invoice would retry a day later, indefinitely, and
    // never exhaust: a dead card presented to an issuer every day until
    // somebody noticed. The `Payment` row's `attempt` is the authority
    // because it is what was actually tried.
    const attempts = attempt;

    const retryAt = nextAttemptAt({ attempts, firstFailedAt, decline });
    const givingUp = retryAt == null;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'failed',
          settledAt: now,
          failureCode: code,
          failureMessage: message,
        },
      });

      const settled = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          // `uncollectible` is not `void`: this is owed and was pursued, and
          // conflating the two makes the revenue figures unreconcilable.
          status: givingUp ? 'uncollectible' : 'open',
          firstFailedAt,
          nextAttemptAt: retryAt,
          lastFailureCode: code,
        },
      });

      if (invoice.subscriptionId) {
        const subscription = await tx.subscription.findUnique({
          where: { id: invoice.subscriptionId },
        });

        if (
          subscription &&
          (subscription.status === 'active' || subscription.status === 'trialing')
        ) {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'pastDue',
              pastDueSince: firstFailedAt,
              version: { increment: 1 },
            },
          });
        }
      }

      await this.audit.record(
        {
          actorUserId: null,
          action: 'billing.payment_failed',
          entityType: 'Invoice',
          entityId: invoice.id,
          changedFields: ['status', 'attemptCount', 'nextAttemptAt', 'lastFailureCode'],
        },
        tx,
      );

      return settled;
    });

    await this.sendDunning(updated, {
      exhausted: givingUp,
      retryAt,
      attempts,
    });

    return updated;
  }

  // ─── the processor calling back ───────────────────────────────────────────

  /**
   * Settles a payment from a webhook.
   *
   * The event's uniqueness has already been claimed by the caller, so this is
   * only reached once per event. What it still has to survive is the *other*
   * ordering: a webhook that arrives before the charge call returned, and a
   * webhook for a payment we already settled ourselves.
   */
  async settleFromWebhook(input: {
    externalPaymentId: string;
    succeeded: boolean;
    failureCode: string | null;
    failureMessage: string | null;
    now: Date;
  }): Promise<'settled' | 'unknown-payment' | 'already-settled'> {
    const payment = await this.prisma.payment.findUnique({
      where: { externalPaymentId: input.externalPaymentId },
      include: { invoice: true },
    });

    if (!payment) return 'unknown-payment';
    if (payment.status !== 'pending') return 'already-settled';

    if (input.succeeded) {
      await this.recordSuccess(
        payment.invoice,
        payment.id,
        input.externalPaymentId,
        input.now,
      );
    } else {
      await this.recordFailure(payment.invoice, payment.id, {
        code: input.failureCode ?? 'payment_failed',
        message: input.failureMessage ?? 'The payment was not completed.',
        // From the payment being settled, which is the attempt this event is
        // about — a late webhook may well concern an earlier one.
        attempt: payment.attempt,
        now: input.now,
      });
    }

    return 'settled';
  }

  /**
   * Records a refund issued at the processor.
   *
   * Refunds are initiated in the processor's own console by whoever is having
   * the conversation about them, not through an endpoint here — there is no
   * administrative surface in this build for one, and a refund button with no
   * approval behind it is worse than no button. What this system owes is
   * reconciliation: a refund that happened must be visible against the invoice
   * it reverses, or the ledger and the bank disagree.
   */
  async recordRefund(input: {
    externalPaymentId: string;
    amountCents: number;
    now: Date;
  }): Promise<'recorded' | 'unknown-payment'> {
    const payment = await this.prisma.payment.findUnique({
      where: { externalPaymentId: input.externalPaymentId },
    });
    if (!payment) return 'unknown-payment';

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'refunded', settledAt: input.now },
      });

      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          amountPaidCents: {
            decrement: Math.min(input.amountCents, payment.amountCents),
          },
        },
      });

      await this.audit.record(
        {
          actorUserId: null,
          action: 'billing.payment_refunded',
          entityType: 'Invoice',
          entityId: payment.invoiceId,
          changedFields: ['amountPaidCents'],
        },
        tx,
      );
    });

    return 'recorded';
  }

  // ─── correspondence ───────────────────────────────────────────────────────

  private async sendReceipt(invoice: Invoice): Promise<void> {
    const context = await this.mailContext(invoice);
    if (!context) return;

    await this.deliver(
      paymentReceiptEmail(
        { appUrl: this.config.PUBLIC_APP_URL },
        {
          to: context.billingEmail,
          invoiceNumber: invoice.number,
          amountCents: invoice.totalCents,
          periodEnd: context.subscription?.currentPeriodEnd ?? invoice.dueAt,
        },
      ),
    );
  }

  private async sendDunning(
    invoice: Invoice,
    state: { exhausted: boolean; retryAt: Date | null; attempts: number },
  ): Promise<void> {
    const context = await this.mailContext(invoice);
    if (!context) return;

    if (state.exhausted) {
      await this.deliver(
        subscriptionExpiredEmail(
          { appUrl: this.config.PUBLIC_APP_URL },
          {
            to: context.billingEmail,
            invoiceNumber: invoice.number,
            amountCents: invoice.totalCents,
          },
        ),
      );
      return;
    }

    const graceEnd = context.subscription
      ? graceEndsAt(toEntitlementState(context.subscription))
      : invoice.dueAt;

    await this.deliver(
      paymentFailedEmail(
        { appUrl: this.config.PUBLIC_APP_URL },
        {
          to: context.billingEmail,
          invoiceNumber: invoice.number,
          amountCents: invoice.totalCents,
          nextAttemptAt: state.retryAt,
          graceEndsAt: graceEnd,
        },
      ),
    );
  }

  private async mailContext(invoice: Invoice): Promise<{
    billingEmail: string;
    subscription: SubscriptionRow | null;
  } | null> {
    const account = await this.prisma.billingAccount.findUnique({
      where: { id: invoice.billingAccountId },
    });
    if (!account) return null;

    const subscription = invoice.subscriptionId
      ? await this.prisma.subscription.findUnique({
          where: { id: invoice.subscriptionId },
          include: { plan: { include: { seatTiers: true } }, billingAccount: true },
        })
      : null;

    return { billingEmail: account.billingEmail, subscription };
  }

  /**
   * Mail failure never fails the collection that produced it.
   *
   * The money has already moved, or already failed to. Throwing here would
   * roll a sweep back over an SMTP timeout and leave the outcome unrecorded,
   * which is a far worse state than a receipt nobody received.
   */
  private async deliver(message: Parameters<MailPort['send']>[0]): Promise<void> {
    try {
      await this.mail.send(message);
    } catch (error) {
      this.logger.error(
        `Billing mail failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  // ─── reading ──────────────────────────────────────────────────────────────

  listForAccount(billingAccountId: string, take = 50): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({
      where: { billingAccountId },
      orderBy: { issuedAt: 'desc' },
      take,
    });
  }

  /**
   * Invoices the sweep should attempt: a scheduled retry that has come due,
   * **or** an invoice nobody has attempted at all.
   *
   * The second half is the safety net, and it is what makes the whole design
   * hold. Several call sites raise an invoice inside a transaction and collect
   * after it commits; any one of them can lose the collection to a crash, a
   * deploy, or simply to running inside a caller's transaction that must not
   * be held open across a processor call. Without this clause such an invoice
   * would sit open forever with `nextAttemptAt` null — money owed, nobody
   * dunned, and no error anywhere. With it, no caller can orphan an invoice by
   * forgetting to collect it; the worst outcome is that collection is late.
   */
  dueForRetry(now: Date, take = 100): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({
      where: {
        status: 'open',
        totalCents: { gt: 0 },
        OR: [
          { nextAttemptAt: { not: null, lte: now } },
          { attemptCount: 0, dueAt: { lte: now } },
        ],
      },
      orderBy: { issuedAt: 'asc' },
      take,
    });
  }

  /** Guard used by the controller before it charges on demand. */
  assertCollectable(invoice: Invoice): void {
    if (invoice.status !== 'open') {
      throw new ValidationError('That invoice is not awaiting payment.');
    }
    if (isExhausted(invoice.attemptCount)) {
      throw new ValidationError('That invoice has had every scheduled attempt.');
    }
  }

  /** Exposed for the sweep's log line. */
  static readonly noPaymentMethodCode = NO_PAYMENT_METHOD;

  /** Amount owed, as `Money`, for callers that do arithmetic on it. */
  static amountDue(invoice: Invoice): Money {
    return new Money(invoice.totalCents - invoice.amountPaidCents);
  }
}
