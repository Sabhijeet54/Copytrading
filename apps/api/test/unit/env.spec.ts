import { randomBytes } from 'node:crypto';
import { EnvValidationError, loadApiEnv, loadWorkerEnv } from '@ctp/config';

const base = () => ({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(48),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

describe('environment validation', () => {
  it('accepts a minimal development config and defaults PAPER_MODE to true', () => {
    const env = loadApiEnv(base());
    expect(env.PAPER_MODE).toBe(true);
    expect(env.APP_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
  });

  it('parses PAPER_MODE strictly', () => {
    expect(loadApiEnv({ ...base(), PAPER_MODE: 'false' }).PAPER_MODE).toBe(false);
    expect(() => loadApiEnv({ ...base(), PAPER_MODE: 'no' })).toThrow(EnvValidationError);
    expect(() => loadApiEnv({ ...base(), PAPER_MODE: '0' })).toThrow(EnvValidationError);
  });

  it('rejects short JWT secrets and wrong-size encryption keys', () => {
    expect(() => loadApiEnv({ ...base(), JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadApiEnv({ ...base(), ENCRYPTION_KEY: randomBytes(16).toString('base64') })).toThrow(/ENCRYPTION_KEY/);
  });

  it('requires secure cookies outside development', () => {
    expect(() => loadApiEnv({ ...base(), APP_ENV: 'production' })).toThrow(/COOKIE_SECURE/);
    expect(loadApiEnv({ ...base(), APP_ENV: 'production', COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('never includes secret values in error messages', () => {
    const secret = 'super-secret-but-too-short';
    try {
      loadApiEnv({ ...base(), JWT_SECRET: secret });
      fail('expected to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('treats empty broker variables as unset', () => {
    const env = loadWorkerEnv({ ...base(), ZERODHA_API_KEY: '', ANGEL_API_KEY: '  ' });
    expect(env.ZERODHA_API_KEY).toBeUndefined();
    expect(env.ANGEL_API_KEY).toBeUndefined();
  });
});
