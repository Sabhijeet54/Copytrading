import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';
import { RedisKeys } from '@ctp/types';

/**
 * Redis-backed storage for @nestjs/throttler so limits hold across multiple API instances.
 * Fixed-window counter + block key, executed atomically in Lua.
 */
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blockTtl = tonumber(ARGV[3])
end
return { hits, ttl, blockTtl }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${RedisKeys.rateLimitPrefix}${throttlerName}:${key}`;
    const [hits, ttlMs, blockMs] = (await this.redis.eval(
      SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      String(ttl),
      String(limit),
      String(blockDuration > 0 ? blockDuration : ttl),
    )) as [number, number, number];

    const isBlocked = blockMs > 0;
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockMs / 1000) : 0,
    };
  }
}
