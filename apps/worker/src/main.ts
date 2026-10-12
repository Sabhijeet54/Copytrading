/**
 * Persistent background worker (runs as its own Railway service — never as a serverless function).
 *
 * Phase 1: boots with validated config, connects to PostgreSQL and Redis, publishes a heartbeat
 * for health checks and shuts down gracefully. Copy-engine, order-execution, reconciliation and
 * broker-event processors are registered here in Phases 2–3.
 */
import Redis from 'ioredis';
import { EnvValidationError, loadDotenv, loadWorkerEnv } from '@ctp/config';
import { createPrismaClient } from '@ctp/database';
import { Heartbeat } from './heartbeat';
import { createLogger } from './logger';

const log = createLogger('worker');

async function main(): Promise<void> {
  loadDotenv();
  const env = loadWorkerEnv();

  const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL, poolMax: 5 });
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  log.info('Connected to PostgreSQL');

  // maxRetriesPerRequest: null is required by BullMQ workers (Phase 3) and keeps commands
  // queued during short Redis outages instead of failing them.
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  redis.on('error', (err) => log.error('Redis error', { error: err.message }));
  await redis.ping();
  log.info('Connected to Redis');

  const heartbeat = new Heartbeat(redis, env.WORKER_HEARTBEAT_INTERVAL_MS, env.PAPER_MODE, (err) =>
    log.error('Heartbeat failed', { error: err.message }),
  );
  await heartbeat.start();

  log.info('Worker started', { env: env.APP_ENV, paperMode: env.PAPER_MODE, pid: process.pid });
  if (!env.PAPER_MODE) log.warn('PAPER_MODE=false — real broker orders may be placed once broker adapters are enabled.');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down', { signal });
    const force = setTimeout(() => {
      log.error('Forced exit after shutdown timeout');
      process.exit(1);
    }, 15_000);
    force.unref();
    try {
      await heartbeat.stop();
      await redis.quit();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { error: reason instanceof Error ? reason.message : String(reason) });
});

main().catch((err) => {
  if (err instanceof EnvValidationError) console.error(err.message);
  else log.error('Fatal worker startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
