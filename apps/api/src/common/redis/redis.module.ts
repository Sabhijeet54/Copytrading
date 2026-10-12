import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { API_CONFIG, ApiConfig } from '../../config/config.module';

export const REDIS = Symbol('REDIS');

@Injectable()
export class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis(config.REDIS_URL, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        });
        client.on('ready', () => logger.log('Connected to Redis'));
        client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
        return client;
      },
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
export class RedisModule {}
