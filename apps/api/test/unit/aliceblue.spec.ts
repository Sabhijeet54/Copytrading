import { createHash } from 'node:crypto';
import { aliceChecksum, aliceExpiry, aliceStatus } from '../../src/trading/aliceblue.adapter';

describe('Alice Blue adapter helpers', () => {
  it('checksum is sha256(userId + apiKey + encKey)', () => {
    expect(aliceChecksum('AB1', 'key', 'enc')).toBe(createHash('sha256').update('AB1keyenc').digest('hex'));
  });
  it('maps order status', () => {
    expect(aliceStatus('complete')).toBe('FILLED');
    expect(aliceStatus('rejected')).toBe('REJECTED');
    expect(aliceStatus('cancelled')).toBe('CANCELLED');
    expect(aliceStatus('open')).toBe('OPEN');
    expect(aliceStatus('trigger pending')).toBe('OPEN');
  });
  it('parses expiry formats', () => {
    expect(aliceExpiry('2026-11-26')).toBe('2026-11-26');
    expect(aliceExpiry('26-Nov-2026')).toBe('2026-11-26');
  });
});
