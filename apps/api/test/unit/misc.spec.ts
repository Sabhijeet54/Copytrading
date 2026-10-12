import { getDummyHash, hashPassword, verifyPassword } from '@ctp/shared';
import { parseDatabaseUrl } from '@ctp/database';
import { startOfTradingDayIST } from '../../src/admin/admin.service';

describe('password hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse 1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse 1')).toBe(true);
    expect(await verifyPassword(hash, 'wrong horse 1')).toBe(false);
  });

  it('never throws on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('provides a valid dummy hash for timing equalisation', async () => {
    expect((await getDummyHash()).startsWith('$argon2id$')).toBe(true);
  });
});

describe('startOfTradingDayIST', () => {
  it('returns IST midnight as UTC (18:30 previous day)', () => {
    expect(startOfTradingDayIST(new Date('2026-10-08T03:00:00Z')).toISOString()).toBe('2026-10-07T18:30:00.000Z');
  });
  it('rolls over at IST midnight, not UTC midnight', () => {
    expect(startOfTradingDayIST(new Date('2026-10-07T19:00:00Z')).toISOString()).toBe('2026-10-07T18:30:00.000Z');
    expect(startOfTradingDayIST(new Date('2026-10-07T18:00:00Z')).toISOString()).toBe('2026-10-06T18:30:00.000Z');
  });
});

describe('parseDatabaseUrl', () => {
  it('moves ?schema= out of the connection string', () => {
    const r = parseDatabaseUrl('postgresql://u:p@h:5432/db?schema=app&sslmode=require');
    expect(r.schema).toBe('app');
    expect(r.connectionString).toBe('postgresql://u:p@h:5432/db?sslmode=require');
  });
});
