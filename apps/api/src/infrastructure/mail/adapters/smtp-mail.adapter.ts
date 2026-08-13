import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import type { MailMessage, MailPort, MailResult } from '../mail.port';

/**
 * SMTP, which is Mailpit locally and SES in production.
 *
 * One adapter for both is not a shortcut: SES's SMTP interface is the same
 * protocol with credentials, so the code path exercised on a laptop is the
 * code path that runs in production. An SES-SDK adapter used only in
 * production would be the one path nobody tests.
 */
export class SmtpMailAdapter implements MailPort {
  readonly driver = 'smtp' as const;

  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter;

  constructor(
    private readonly options: {
      host: string;
      port: number;
      user?: string;
      password?: string;
      from: string;
    },
  ) {
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      // STARTTLS on 587 (SES), plaintext on 1025 (Mailpit, loopback only).
      secure: options.port === 465,
      requireTLS: options.port === 587,
      ...(options.user
        ? { auth: { user: options.user, pass: options.password ?? '' } }
        : {}),
      pool: true,
      maxConnections: 5,
    });
  }

  async send(message: MailMessage): Promise<MailResult> {
    // nodemailer types `sendMail`'s result as `any`. Narrowed here rather
    // than trusted, so a change in its shape is a type error and not a
    // `providerRef` that silently becomes undefined.
    const info = (await this.transport.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      headers: message.correlationId
        ? { 'X-Correlation-Id': message.correlationId }
        : undefined,
    })) as { messageId?: string };

    // The recipient address is deliberately absent from this line: it is on
    // the redaction denylist, and a log that names who was emailed about what
    // is a second copy of the relationship graph.
    this.logger.debug(`Mail accepted by ${this.options.host} (${info.messageId})`);

    return { providerRef: info.messageId ?? null };
  }

  async verify(): Promise<boolean> {
    try {
      await this.transport.verify();
      return true;
    } catch {
      return false;
    }
  }
}
