import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../auth/auth.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@ApiTags('system')
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
  @ApiOperation({
    summary: 'Liveness',
    description:
      'Checks nothing external on purpose. A database blip must not get the container killed and restarted, which would turn a recoverable outage into a crash loop.',
  })
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: may this instance take traffic. This one *does* need the database. */
  @Public()
  @ApiOperation({
    summary: 'Readiness — may this instance take traffic',
  })
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
