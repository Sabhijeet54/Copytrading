import { base32Decode, extractTotpSecret, totp } from '../../src/brokers/totp';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B, SHA1 seed "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('decodes base32', () => {
    expect(base32Decode(SECRET).toString('ascii')).toBe('12345678901234567890');
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC vector at T=%i', (t, code) => {
    expect(totp(SECRET, t * 1000, 8)).toBe(code);
  });

  it('gives 6 digits by default and tolerates spaces/lowercase', () => {
    expect(totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59_000)).toBe('287082');
  });

  it('reads the secret from an otpauth URI', () => {
    expect(extractTotpSecret(`otpauth://totp/Angel:ABC?secret=${SECRET}&issuer=Angel`)).toBe(SECRET);
  });
});
