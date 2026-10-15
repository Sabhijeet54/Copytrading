import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Exchange, PrismaClient, ProductType } from '@ctp/database';
import { AuditService } from '../audit/audit.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { angelScripMaster } from '../market-data/angel-scrip-master';
import { InstrumentsService } from '../market-data/instruments.service';
import { instrumentKey, PriceCacheService } from '../market-data/price-cache.service';
import { AccountEvents } from '../realtime/account-events';
import { ClientRegistryService } from './client-registry.service';
import { CopyEngineService } from './copy-engine.service';
import { computeCopyQuantity } from './copy-quantity';
import { TradingService } from './trading.service';

export interface ResizeResult {
  symbol: string;
  from: number;
  to: number;
  side: 'BUY' | 'SELL';
  quantity: number;
  ok: boolean;
  error?: string;
}

const N = (v: unknown) => (v == null ? null : Number(v));

/**
 * When a client changes his lot multiplier, already-booked (still OPEN) trades of that strategy are resized to
 * the new size: e.g. 1× → 2× buys one more lot of every open position, 2× → 1× sells the extra lot.
 * Orders are MARKET (paper: simulated at LTP). Each change is recorded (audit `manualAdjust`) so today's P&L,
 * the trade book and the copy engine's net position stay correct — the master's later exit closes the new size.
 */
@Injectable()
export class PositionResizeService {
  private readonly logger = new Logger('PositionResize');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly registry: ClientRegistryService,
    private readonly engine: CopyEngineService,
    private readonly trading: TradingService,
    private readonly prices: PriceCacheService,
    private readonly instruments: InstrumentsService,
    private readonly audit: AuditService,
    private readonly accountEvents: AccountEvents,
  ) {}

  async resizeOpen(followerId: string, actorUserId: string): Promise<ResizeResult[]> {
    const sub = await this.prisma.strategyFollower.findUnique({ where: { id: followerId }, include: { strategy: true, brokerAccount: true } });
    if (!sub || !sub.brokerAccount || sub.copyStatus !== 'ON') return [];
    const account = sub.brokerAccount;
    const open = await this.prisma.masterTrade.findMany({ where: { strategyId: sub.strategyId, signalStatus: 'OPEN' }, orderBy: { createdAt: 'asc' } });
    if (!open.length) return [];

    // Master's open quantity per contract (+ long / − short).
    const byInst = new Map<string, { exchange: Exchange; symbol: string; productType: ProductType; net: number; lot: number; ids: string[] }>();
    for (const t of open) {
      const size = (t.filledQuantity > 0 ? t.filledQuantity : t.quantity) - t.closedQuantity;
      if (size <= 0) continue;
      const k = `${t.exchange}:${t.symbol}:${t.productType}`;
      const raw = t.rawPayload as { lotSize?: number } | null;
      const lot = this.instruments.lotSize(t.exchange, t.symbol) ?? angelScripMaster.get(t.exchange, t.symbol)?.lotSize ?? raw?.lotSize ?? 1;
      const cur = byInst.get(k) ?? { exchange: t.exchange, symbol: t.symbol, productType: t.productType, net: 0, lot, ids: [] };
      cur.net += t.side === 'BUY' ? size : -size;
      cur.ids.push(t.id);
      byInst.set(k, cur);
    }

    const settings = {
      allocationMode: sub.allocationMode,
      allocationPercent: N(sub.allocationPercent),
      allocationAmount: N(sub.allocationAmount),
      fixedQuantity: sub.fixedQuantity,
      fixedLots: sub.fixedLots,
      maxLots: sub.maxLots,
      maxQuantity: sub.maxQuantity,
      maxTradeValue: null, // resizing an existing trade is not limited by per-order value caps
    };
    const strat = { masterCapital: N(sub.strategy.masterCapital), maxOrderValue: null, maxQuantityPerOrder: sub.strategy.maxQuantityPerOrder };
    const simulated = this.trading.isSimulated(account);
    const out: ResizeResult[] = [];

    for (const i of byInst.values()) {
      if (!i.net) continue;
      const price = this.prices.get(instrumentKey(i.exchange, i.symbol)) ?? null;
      const target = Math.sign(i.net) * computeCopyQuantity(strat, settings, Math.abs(i.net), null, i.lot).qty;
      const current = this.registry.clientNet(sub.id, i.exchange, i.symbol, i.productType);
      // Only resize a position the client actually holds in the same direction as the master.
      if (current === 0 || Math.sign(current) !== Math.sign(i.net)) continue;
      const diff = target - current;
      if (diff === 0) continue;
      const side = diff > 0 ? 'BUY' : 'SELL';
      const qty = Math.abs(diff);
      const res: ResizeResult = { symbol: i.symbol, from: Math.abs(current), to: Math.abs(target), side, quantity: qty, ok: false };
      try {
        let orderId: string | null = null;
        if (simulated) {
          if (price == null) throw new Error('No live price — try again in a moment');
          await this.engine.applyPaperFill(sub.followerUserId, account.id, { exchange: i.exchange, symbol: i.symbol, productType: i.productType, side }, qty, price);
        } else {
          this.trading.assertOrderAllowed(account);
          const ad = await this.trading.adapterFor(account);
          ({ brokerOrderId: orderId } = await ad.placeOrder({ exchange: i.exchange, symbol: i.symbol, side, quantity: qty, orderType: 'MARKET', productType: i.productType, tag: 'ctpresize' }));
        }
        this.registry.applyClientFill(sub.id, i.exchange, i.symbol, i.productType, diff);
        await this.audit.log({
          action: 'PROFILE_UPDATED',
          actorUserId,
          targetType: 'StrategyFollower',
          targetId: sub.id,
          metadata: { manualAdjust: true, accountId: account.id, exchange: i.exchange, symbol: i.symbol, productType: i.productType, side, quantity: qty, price, orderId, signalIds: i.ids },
        });
        res.ok = true;
      } catch (err) {
        res.error = (err as Error).message;
        this.logger.warn(`Resize ${i.symbol} for follower ${sub.id} failed: ${res.error}`);
      }
      out.push(res);
    }
    if (out.length) this.accountEvents.emit({ type: 'settings', brokerAccountId: account.id, userId: sub.followerUserId });
    return out;
  }
}
