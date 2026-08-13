import { Module } from '@nestjs/common';

import { RetentionService } from './retention.service';
import { AuthModule } from '../auth/auth.module';
import { CareModule } from '../care/care.module';

@Module({
  imports: [AuthModule, CareModule],
  providers: [RetentionService],
})
export class RetentionModule {}
