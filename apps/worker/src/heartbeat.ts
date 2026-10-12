import type Redis from 'ioredis';
import { hostname } from 'node:os';
import { RedisKeys, WorkerHeartbeat } from '@ctp/types';

/**
 * Publishes a liveness record to Redis that the API reads for GET /health.
 * The key carries a TTL of 3× the interval, so a crashed/frozen worker disappears automatically.
 */
export class Heartbeat {
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly redis: Redis,
    private readonly intervalMs: number,
    private readonly paperMode: boolean,
    private readonly onError: (err: Error) => void,
  ) {}

  async beat(): Promise<void> {
    const payload: WorkerHeartbeat = {
      pid: process.pid,
      host: hostname(),
      startedAt: this.startedAt,
      at: new Date().toISOString(),
      paperMode: this.paperMode,
    };
    await this.redis.set(RedisKeys.workerHeartbeat, JSON.stringify(payload), 'PX', this.intervalMs * 3);
  }

  async start(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      this.beat().catch(this.onError);
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.redis.del(RedisKeys.workerHeartbeat).catch(() => undefined);
  }
}
