/**
 * Prisma CLI configuration (migrate, generate, studio, seed).
 * Lets you run `npx prisma <command>` from the repo root as well as via the npm scripts.
 * Note: when a config file is used, Prisma does not auto-load .env, so it is loaded here.
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnv({ path: path.join(__dirname, '.env'), quiet: true });

export default defineConfig({
  schema: path.join(__dirname, 'packages/database/prisma/schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'packages/database/prisma/migrations'),
    seed: 'npm run seed -w @ctp/database',
  },
});
