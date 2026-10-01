import { Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config.module';
import { MessagingModule } from '../messaging/messaging.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { TelephonyWebhooksController } from './telephony-webhooks.controller';

@Module({
  imports: [ConfigModule, MessagingModule],
  controllers: [CallsController, TelephonyWebhooksController],
  providers: [CallsService],
})
export class CallsModule {}
