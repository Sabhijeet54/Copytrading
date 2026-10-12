import { Prisma } from '@ctp/database';
import { CopyEngineService } from '../../src/trading/copy-engine.service';

const D = (n: number) => new Prisma.Decimal(n);
const engine = new CopyEngineService({} as never, {} as never, {} as never, {} as never);
const qty = (s: object, f: object, masterQty: number, price: number | null, lot = 1) =>
  (engine as unknown as { followerQuantity: (...a: unknown[]) => { qty: number } }).followerQuantity(
    { masterCapital: D(1_000_000), maxOrderValue: null, maxQuantityPerOrder: null, ...s },
    { allocationMode: 'CAPITAL_PERCENTAGE', allocationPercent: null, allocationAmount: null, fixedQuantity: null, maxQuantity: null, maxTradeValue: null, ...f },
    masterQty,
    price,
    lot,
  ).qty;

describe('copy quantity', () => {
  it('percentage of master quantity', () => expect(qty({}, { allocationPercent: D(20) }, 100, 10)).toBe(20));
  it('proportional to capital', () => expect(qty({}, { allocationMode: 'PROPORTIONAL', allocationAmount: D(100_000) }, 50, 10)).toBe(5));
  it('fixed quantity', () => expect(qty({}, { allocationMode: 'FIXED_QUANTITY', fixedQuantity: 7 }, 1, 10)).toBe(7));
  it('rounds down to lot size', () => expect(qty({}, { allocationPercent: D(50) }, 150, 10, 25)).toBe(75));
  it('below one lot → 0', () => expect(qty({}, { allocationPercent: D(10) }, 75, 10, 75)).toBe(0));
  it('follower max quantity', () => expect(qty({}, { allocationPercent: D(100), maxQuantity: 30 }, 100, 10)).toBe(30));
  it('strategy max order value', () => expect(qty({ maxOrderValue: D(1000) }, { allocationPercent: D(100) }, 500, 10)).toBe(100));
  it('proportional without master capital → 0', () =>
    expect(qty({ masterCapital: D(0) }, { allocationMode: 'PROPORTIONAL', allocationAmount: D(1000) }, 10, 10)).toBe(0));
});
