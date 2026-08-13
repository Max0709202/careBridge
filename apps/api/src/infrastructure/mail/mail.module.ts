import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { MAIL, type MailPort } from './mail.port';
import { SmtpMailAdapter } from './adapters/smtp-mail.adapter';
import { LogMailAdapter } from './adapters/log-mail.adapter';

/**
 * The one place that knows which mail adapter is live. Modules inject `MAIL`
 * and never a concrete class — enforced by the eslint boundary rule, not by
 * memory.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MailPort =>
        config.MAIL_DRIVER === 'smtp'
          ? new SmtpMailAdapter({
              host: config.MAIL_SMTP_HOST,
              port: config.MAIL_SMTP_PORT,
              user: config.MAIL_SMTP_USER,
              password: config.MAIL_SMTP_PASSWORD,
              from: config.MAIL_FROM,
            })
          : new LogMailAdapter(),
    },
  ],
  exports: [MAIL],
})
export class MailModule {}
