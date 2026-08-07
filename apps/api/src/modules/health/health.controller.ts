import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../auth/auth.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Liveness: is the process up. Deliberately checks nothing external — a
   * database blip must not get the container killed and restarted, which would
   * turn a recoverable outage into a crash loop.
   */
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: may this instance take traffic. This one *does* need the database. */
  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
    ]);
  }

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
    ]);
  }
}
