import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisKeys } from '@ctp/types';
import { REDIS } from '../common/redis/redis.module';

export interface Tick {
  ltp: number;
  /** epoch ms when the tick was received */
  ts: number;
}

export const instrumentKey = (exchange: string, symbol: string) => `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;

/**
 * Process-wide LTP cache fed by the master market feed. Reads are synchronous memory lookups (no I/O),
 * so the order path never calls a quote API. Ticks are flushed to the Redis hash `ctp:ltp` in batches
 * (every 500 ms) for other processes and for a warm start after a restart.
 */
@Injectable()
export class PriceCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PriceCache');
  private readonly ticks = new Map<string, Tick>();
  private dirty = new Map<string, Tick>();
  private timer?: NodeJS.Timeout;
  lastTickAt: number | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    try {
      const all = await this.redis.hgetall(RedisKeys.ltpHash);
      for (const [k, v] of Object.entries(all)) {
        const t = JSON.parse(v) as Tick;
        if (Number.isFinite(t.ltp)) this.ticks.set(k, t);
      }
      if (this.ticks.size) this.logger.log(`Warm-started ${this.ticks.size} LTPs from Redis`);
    } catch {
      /* cache stays cold */
    }
    this.timer = setInterval(() => void this.flush(), 500);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  set(key: string, ltp: number, ts = Date.now()): void {
    if (!Number.isFinite(ltp) || ltp <= 0) return;
    const t = { ltp, ts };
    this.ticks.set(key, t);
    this.dirty.set(key, t);
    this.lastTickAt = ts;
  }

  /** LTP or null. `maxAgeMs` rejects stale prices. */
  get(key: string, maxAgeMs?: number): number | null {
    const t = this.ticks.get(key);
    if (!t) return null;
    if (maxAgeMs !== undefined && Date.now() - t.ts > maxAgeMs) return null;
    return t.ltp;
  }

  getTick(key: string): Tick | undefined {
    return this.ticks.get(key);
  }

  snapshot(keys: string[]): Record<string, Tick | null> {
    return Object.fromEntries(keys.map((k) => [k, this.ticks.get(k) ?? null]));
  }

  private async flush(): Promise<void> {
    if (!this.dirty.size) return;
    const batch = this.dirty;
    this.dirty = new Map();
    try {
      const args: string[] = [];
      for (const [k, t] of batch) args.push(k, JSON.stringify(t));
      await this.redis.hset(RedisKeys.ltpHash, ...args);
    } catch (err) {
      this.logger.warn(`LTP flush failed: ${(err as Error).message}`);
    }
  }
}
