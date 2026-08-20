import type { MailMessage } from '../../infrastructure/mail/mail.port';

/**
 * The dunning correspondence.
 *
 * Held to the same contentless rule as every other message this system sends
 * (FOUNDATION §9): no patient name, no appointment, no address. Billing mail
 * gets one narrow exception — the **amount and the invoice number** — because
 * a message asking somebody to fix a payment without saying which payment or
 * how much is indistinguishable from a phishing attempt, and the correct
 * response to a phishing attempt is to ignore it.
 *
 * What they never say is what stops working. "Your live tracking will be
 * disabled" is true, frightening, and wrong to lead with — the grace window
 * exists precisely so nothing stops immediately, and the message that gets a
 * card updated is the calm one.
 */

interface TemplateContext {
  appUrl: string;
  correlationId?: string;
}

function billingUrl(context: TemplateContext): string {
  return new URL('/settings/plan', context.appUrl).toString();
}

function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function paymentFailedEmail(
  context: TemplateContext,
  options: {
    to: string;
    invoiceNumber: string;
    amountCents: number;
    /** Null when the schedule is over — the wording changes materially. */
    nextAttemptAt: Date | null;
    graceEndsAt: Date;
  },
): MailMessage {
  const retry = options.nextAttemptAt
    ? `We will try again on ${formatDate(options.nextAttemptAt)}.`
    : 'We will not try this card again.';

  return {
    to: options.to,
    subject: `Your CareBridge payment did not go through (${options.invoiceNumber})`,
    text: [
      `We could not take ${money(options.amountCents)} for invoice ${options.invoiceNumber}.`,
      '',
      retry,
      '',
      // Said plainly and early, because the fear this message creates is
      // "have I just lost the ability to see where my mother is".
      `Nothing has been switched off. Your plan keeps working until ${formatDate(options.graceEndsAt)}, which gives you time to sort this out.`,
      '',
      'Update your card here:',
      billingUrl(context),
      '',
      'If you have already updated it, you can ignore this message.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

export function subscriptionExpiredEmail(
  context: TemplateContext,
  options: { to: string; invoiceNumber: string; amountCents: number },
): MailMessage {
  return {
    to: options.to,
    subject: 'Your CareBridge plan has stopped',
    text: [
      `We were not able to take ${money(options.amountCents)} for invoice ${options.invoiceNumber}, and we have stopped trying.`,
      '',
      'Your plan has ended. Appointments and history are untouched — nothing has been deleted.',
      '',
      'Start again whenever you are ready:',
      billingUrl(context),
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

export function paymentReceiptEmail(
  context: TemplateContext,
  options: {
    to: string;
    invoiceNumber: string;
    amountCents: number;
    periodEnd: Date;
  },
): MailMessage {
  return {
    to: options.to,
    subject: `CareBridge receipt ${options.invoiceNumber}`,
    text: [
      `We took ${money(options.amountCents)} for invoice ${options.invoiceNumber}.`,
      '',
      `Your plan runs until ${formatDate(options.periodEnd)}.`,
      '',
      'The itemised invoice is here:',
      billingUrl(context),
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

/**
 * A date, in the one format that is unambiguous to both a British and an
 * American reader. "03/04" is two different days depending on who opens it,
 * and this message is about money.
 */
function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
