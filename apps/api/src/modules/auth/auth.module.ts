import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CredentialTokensService } from './credential-tokens.service';
import { MfaService } from './mfa.service';
import { SessionsService } from './sessions.service';
import { ConfigModule } from '../../common/config.module';
import { AccessTokenModule } from './access-token.module';
import { CareModule } from '../care/care.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    ConfigModule,
    CareModule,
    BillingModule,
    // Carries the JWT configuration as well as the verifier, so this module
    // and the tracking gateway share one secret, one algorithm and — the part
    // that matters — one implementation of the `tokenVersion` check.
    AccessTokenModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    CredentialTokensService,
    MfaService,
    SessionsService,
  ],
  exports: [AuthService, AuthGuard, CredentialTokensService],
})
export class AuthModule {}
