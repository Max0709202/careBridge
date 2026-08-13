import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { ConfigModule } from './common/config.module';
import { LoggingModule } from './common/logging/logging.module';
import { RequestLoggerMiddleware } from './common/logging/request-logger.middleware';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { ErrorFilter } from './common/error.filter';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { PushModule } from './infrastructure/push/push.module';
import { MapsModule } from './infrastructure/maps/maps.module';
import { RetentionModule } from './modules/retention/retention.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { CareModule } from './modules/care/care.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    PrismaModule,
    // Infrastructure before the modules that depend on it. Each of these is
    // global, and each resolves exactly one adapter from configuration —
    // which adapter is live is decided once, here, and nowhere else.
    RedisModule,
    QueueModule,
    MailModule,
    PushModule,
    MapsModule,
    AuditModule,
    CareModule,
    AuthModule,
    HealthModule,
    RetentionModule,
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
    // Order matters. CorrelationMiddleware opens the async-local scope; the
    // request logger reads the id out of it when the response finishes.
    consumer.apply(CorrelationMiddleware, RequestLoggerMiddleware).forRoutes('*');
  }
}
