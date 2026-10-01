import { Module } from '@nestjs/common';

import { AccessTokenModule } from '../auth/access-token.module';
import { ConversationAuthorizer } from './conversation.authorizer';
import { MessagingController } from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';

/**
 * Conversations and their live fan-out. `MessagingService` is exported for
 * the calls module, which writes call outcomes into the thread a call was
 * placed from.
 */
@Module({
  imports: [AccessTokenModule],
  controllers: [MessagingController],
  providers: [MessagingService, ConversationAuthorizer, MessagingGateway],
  exports: [MessagingService, ConversationAuthorizer],
})
export class MessagingModule {}
