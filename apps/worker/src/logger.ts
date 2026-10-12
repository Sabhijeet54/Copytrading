/** Minimal structured logger. Never pass secrets; metadata is redacted by key name. */
import { redact } from '@ctp/shared';

type Level = 'info' | 'warn' | 'error';

function write(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, scope, message, ...(meta ? { meta: redact(meta) } : {}) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) => write('info', scope, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => write('warn', scope, message, meta),
    error: (message: string, meta?: Record<string, unknown>) => write('error', scope, message, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
