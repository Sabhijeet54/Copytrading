import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export interface CreatePrismaClientOptions {
  /** Defaults to process.env.DATABASE_URL */
  databaseUrl?: string;
  /** Log warnings in addition to errors. Query parameters are never logged. */
  logWarnings?: boolean;
  /** pg pool size (default 10). */
  poolMax?: number;
}

/**
 * Splits Prisma's `?schema=` URL parameter off the connection string: node-postgres does not
 * understand it, so it is passed to the driver adapter as an option instead.
 */
export function parseDatabaseUrl(url: string): { connectionString: string; schema?: string } {
  const u = new URL(url);
  const schema = u.searchParams.get('schema') ?? undefined;
  u.searchParams.delete('schema');
  return { connectionString: u.toString(), schema };
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const { connectionString, schema } = parseDatabaseUrl(url);
  const adapter = new PrismaPg(
    { connectionString, max: options.poolMax ?? 10 },
    schema && schema !== 'public' ? { schema } : undefined,
  );
  return new PrismaClient({
    adapter,
    log: options.logWarnings ? ['warn', 'error'] : ['error'],
  });
}
