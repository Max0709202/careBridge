import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CredentialTokensService } from './credential-tokens.service';
import { MfaService } from './mfa.service';
import { SessionsService } from './sessions.service';
import { ConfigModule } from '../../common/config.module';
import { appConfig } from '../../common/config';
import { CareModule } from '../care/care.module';

@Module({
  imports: [
    ConfigModule,
    CareModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const config = appConfig();
        return {
          secret: config.JWT_SECRET,
          signOptions: { algorithm: 'HS256', issuer: 'carebridge' },
          verifyOptions: { algorithms: ['HS256'], issuer: 'carebridge' },
        };
      },
    }),
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
