import { canonicalFromParts, normalizeBrokerSymbol, parseCanonical, symbolVariants } from '../../src/trading/symbols';

describe('derivative symbols', () => {
  it('parses canonical options and futures', () => {
    expect(parseCanonical('SENSEX15OCT2673800CE')).toEqual({ name: 'SENSEX', dd: '15', month: 10, yy: '26', type: 'CE', strike: '73800' });
    expect(parseCanonical('NIFTY27OCT26FUT')).toMatchObject({ name: 'NIFTY', type: 'FUT' });
    expect(parseCanonical('SBIN')).toBeNull();
  });
  it('builds BSE / Kite variants', () => {
    expect(symbolVariants('SENSEX15OCT2673800CE')).toEqual(
      expect.arrayContaining(['SENSEX15OCT2673800CE', 'SENSEX26O1573800CE', 'SENSEX26OCT73800CE']),
    );
    expect(symbolVariants('NIFTY19JAN2722700PE')).toContain('NIFTY2711922700PE');
    expect(symbolVariants('RELIANCE')).toEqual(['RELIANCE']);
  });
  it('normalizes compact weekly broker symbols to canonical', () => {
    expect(normalizeBrokerSymbol('SENSEX26O1573800CE')).toBe('SENSEX15OCT2673800CE');
    expect(normalizeBrokerSymbol('NIFTY19OCT2622700PE')).toBe('NIFTY19OCT2622700PE');
    expect(normalizeBrokerSymbol('SBIN-EQ')).toBe('SBIN');
  });
  it('canonical from instrument master fields', () => {
    expect(canonicalFromParts('SENSEX', '2026-10-15', 73800, 'CE')).toBe('SENSEX15OCT2673800CE');
    expect(canonicalFromParts('NIFTY', '2026-10-27', null, 'FUT')).toBe('NIFTY27OCT26FUT');
  });
});
