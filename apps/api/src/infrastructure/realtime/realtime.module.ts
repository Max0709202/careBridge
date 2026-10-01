import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { REDIS, type RedisConnection } from '../redis/redis.module';
import { REALTIME_BUS, type RealtimeBusPort } from './realtime-bus.port';
import { InProcessRealtimeBusAdapter } from './adapters/in-process-realtime-bus.adapter';
import { RedisRealtimeBusAdapter } from './adapters/redis-realtime-bus.adapter';

@Injectable()
class RealtimeBusLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REALTIME_BUS) private readonly bus: RealtimeBusPort) {}

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REALTIME_BUS,
      inject: [REDIS],
      useFactory: (redis: RedisConnection): RealtimeBusPort =>
        redis ? new RedisRealtimeBusAdapter(redis) : new InProcessRealtimeBusAdapter(),
    },
    RealtimeBusLifecycle,
  ],
  exports: [REALTIME_BUS],
})
export class RealtimeInfrastructureModule {}
