import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Connects eagerly, but does not refuse to boot without a database. Prisma
   * connects again on the first query, and /health/ready reports the database
   * as down until it does — so an instance started during a database blip
   * stays out of rotation and recovers, rather than crash-looping.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Connected to PostgreSQL');
    } catch (error) {
      this.logger.warn(
        `PostgreSQL is not reachable yet; readiness will fail until it is (${(error as Error).message.split('\n').join(' ')})`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
