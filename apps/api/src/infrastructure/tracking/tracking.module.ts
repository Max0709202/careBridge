import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';

import { REDIS, type RedisConnection } from '../redis/redis.module';
import { POSITION_STORE, type PositionStorePort } from './position-store.port';
import { InProcessPositionStoreAdapter } from './adapters/in-process-position-store.adapter';
import { RedisPositionStoreAdapter } from './adapters/redis-position-store.adapter';

@Injectable()
class PositionStoreLifecycle implements OnApplicationShutdown {
  constructor(@Inject(POSITION_STORE) private readonly store: PositionStorePort) {}

  async onApplicationShutdown(): Promise<void> {
    // The Redis adapter holds a second connection for its subscriber, and a
    // subscriber left open keeps the process alive after everything else has
    // shut down.
    await this.store.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: POSITION_STORE,
      inject: [REDIS],
      useFactory: (redis: RedisConnection): PositionStorePort =>
        redis
          ? new RedisPositionStoreAdapter(redis)
          : new InProcessPositionStoreAdapter(),
    },
    PositionStoreLifecycle,
  ],
  exports: [POSITION_STORE],
})
export class TrackingInfrastructureModule {}
