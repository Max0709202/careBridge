import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { ConfigModule } from './common/config.module';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { ErrorFilter } from './common/error.filter';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { CareModule } from './modules/care/care.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    CareModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorFilter },
    // Authentication is the default; a route has to ask to be public with
    // @Public(). The reverse — remembering @UseGuards on each new controller —
    // is the single most common way an endpoint ships unprotected.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
