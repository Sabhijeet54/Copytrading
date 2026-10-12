import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { HealthResponse, RedisKeys, WorkerHeartbeat } from '@ctp/types';
import { PrismaService } from '../common/prisma/prisma.service';
import { REDIS } from '../common/redis/redis.module';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async redisPing(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async workerHeartbeat(): Promise<WorkerHeartbeat | null> {
    try {
      const raw = await this.redis.get(RedisKeys.workerHeartbeat);
      return raw ? (JSON.parse(raw) as WorkerHeartbeat) : null;
    } catch {
      return null;
    }
  }

  async check(): Promise<HealthResponse> {
    const [db, redis, worker] = await Promise.all([this.prisma.ping(), this.redisPing(), this.workerHeartbeat()]);
    const database = db ? 'connected' : 'disconnected';
    const redisState = redis ? 'connected' : 'disconnected';
    const workerState = worker ? 'connected' : 'disconnected';
    return {
      status: db && redis && worker ? 'ok' : 'degraded',
      database,
      redis: redisState,
      worker: workerState,
    };
  }
}
