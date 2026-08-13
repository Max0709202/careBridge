import { Logger } from '@nestjs/common';

import type { PushMessage, PushPort, PushResult } from '../push.port';

/**
 * Counts the recipients and drops the message. Refused in production.
 *
 * Neither the tokens nor the body are logged. Tokens are device identifiers,
 * and although push bodies are contentless by policy, this adapter is not the
 * place that gets to assume the policy held.
 */
export class LogPushAdapter implements PushPort {
  readonly driver = 'log' as const;

  private readonly logger = new Logger('Push');

  async send(message: PushMessage): Promise<PushResult> {
    this.logger.log(
      `[not sent — PUSH_DRIVER=log] "${message.title}" to ${message.tokens.length} device(s)`,
    );
    return { sent: message.tokens.length, invalidTokens: [] };
  }
}
