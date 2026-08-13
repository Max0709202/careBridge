import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { MailMessage, MailPort, MailResult } from '../mail.port';

/**
 * Prints the subject and drops the message.
 *
 * The default for tests and for anyone running the API without the compose
 * stack. It is refused in production by config validation, because a mailer
 * that silently succeeds while sending nothing produces the worst possible
 * symptom: password resets that never arrive look exactly like nobody asking
 * for one.
 *
 * The body is logged only at trace level and only outside production. It
 * contains the one-time link, which is a live credential.
 */
export class LogMailAdapter implements MailPort {
  readonly driver = 'log' as const;

  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<MailResult> {
    this.logger.log(`[not sent — MAIL_DRIVER=log] ${message.subject}`);
    this.logger.verbose(message.text);
    return { providerRef: `log:${randomUUID()}` };
  }

  async verify(): Promise<boolean> {
    return true;
  }
}
