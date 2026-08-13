/**
 * Outbound email, independent of the vendor.
 *
 * Locally this is Mailpit over SMTP; in production it is SES, also over SMTP,
 * which is why one adapter covers both. The port exists so that swapping SES
 * for anything else is a configuration change rather than an edit to every
 * caller — and so that the contentless-body rule below has one place to live.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. Required — a mail with only HTML looks like spam and reads badly in a screen reader. */
  text: string;
  html?: string;
  /** Correlates a delivery record with the line in the log that produced it. */
  correlationId?: string;
}

export interface MailResult {
  /** Vendor message id, where the vendor gives one. */
  providerRef: string | null;
}

export interface MailPort {
  readonly driver: 'smtp' | 'log';
  send(message: MailMessage): Promise<MailResult>;
  /** Used by /health/ready in environments where mail is load-bearing. */
  verify(): Promise<boolean>;
}

export const MAIL = Symbol('MAIL');
