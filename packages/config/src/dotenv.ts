import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Loads the nearest `.env` walking up from `startDir` (default: cwd).
 * In the monorepo the single `.env` lives at the repo root, while apps run with
 * their own directory as cwd. Variables already present in the environment
 * (e.g. injected by Railway) are never overridden.
 */
export function loadDotenv(startDir: string = process.cwd()): string | undefined {
  let dir = resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate, override: false });
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
