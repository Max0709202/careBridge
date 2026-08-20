import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { PAYMENTS, type PaymentsPort } from './payments.port';
import { LocalPaymentsAdapter } from './adapters/local-payments.adapter';
import { StripePaymentsAdapter } from './adapters/stripe-payments.adapter';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PAYMENTS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PaymentsPort =>
        config.PAYMENTS_DRIVER === 'stripe' &&
        config.STRIPE_SECRET_KEY &&
        config.STRIPE_WEBHOOK_SECRET
          ? new StripePaymentsAdapter(
              config.STRIPE_SECRET_KEY,
              config.STRIPE_WEBHOOK_SECRET,
            )
          : new LocalPaymentsAdapter(config.PAYMENTS_WEBHOOK_SECRET),
    },
  ],
  exports: [PAYMENTS],
})
export class PaymentsModule {}
