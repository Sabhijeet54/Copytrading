import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@ctp/database';
import { startOfTradingDayIST } from '../admin/admin.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { MarketFeedService } from '../market-data/market-feed.service';
import { instrumentKey, PriceCacheService } from '../market-data/price-cache.service';
import { allocationLabel, isRemoved } from './follower-access';

export { allocationLabel, isRemoved, REMOVED_REASON } from './follower-access';

export interface StrategyDaySummary {
  followerId: string;
  strategyId: string;
  name: string;
  strategyStatus: string;
  copyStatus: 'ON' | 'OFF' | 'PAUSED';
  allocation: string;
  todayPnl: number;
  todayTrades: number;
}

/**
 * Today's (IST trading day) P&L of a client, per strategy subscription.
 * Computed from today's executed copy orders (sells − buys) plus the open quantity at the live LTP, so it is
 * the same number on the client dashboard, the client's positions page and the master's client page.
 */
@Injectable()
export class ClientSummaryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly prices: PriceCacheService,
    private readonly feed: MarketFeedService,
  ) {}

  /** `masterUserId` set = only subscriptions to that master's strategies. Removed subscriptions are left out. */
  async today(userId: string, masterUserId?: string): Promise<{ todayPnl: number; strategies: StrategyDaySummary[] }> {
    const since = startOfTradingDayIST();
    const subsAll = await this.prisma.strategyFollower.findMany({
      where: { followerUserId: userId, ...(masterUserId ? { strategy: { masterUserId } } : {}) },
      include: { strategy: { select: { name: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const subs = subsAll.filter((s) => !isRemoved(s));
    const orders = await this.prisma.copyOrder.findMany({
      where: { followerUserId: userId, createdAt: { gte: since }, filledQuantity: { gt: 0 }, strategyFollowerId: { in: subsAll.map((s) => s.id) } },
      select: { strategyFollowerId: true, exchange: true, symbol: true, side: true, filledQuantity: true, averagePrice: true },
    });
    // Per subscription & instrument: cash flow and net quantity.
    const book = new Map<string, Map<string, { cash: number; net: number; last: number }>>();
    const trades = new Map<string, number>();
    for (const o of orders) {
      const px = o.averagePrice == null ? 0 : Number(o.averagePrice);
      const sign = o.side === 'BUY' ? 1 : -1;
      const inst = `${o.exchange}:${o.symbol}`;
      const m = book.get(o.strategyFollowerId) ?? new Map();
      const cur = m.get(inst) ?? { cash: 0, net: 0, last: px };
      cur.cash -= sign * o.filledQuantity * px;
      cur.net += sign * o.filledQuantity;
      cur.last = px || cur.last;
      m.set(inst, cur);
      book.set(o.strategyFollowerId, m);
      trades.set(o.strategyFollowerId, (trades.get(o.strategyFollowerId) ?? 0) + 1);
    }
    // Lot-multiplier resizes of open trades (PositionResizeService): extra bought / sold quantity per subscription.
    const adjusts = await this.prisma.auditLog.findMany({
      where: { action: 'PROFILE_UPDATED', targetType: 'StrategyFollower', targetId: { in: subsAll.map((x) => x.id) }, createdAt: { gte: since } },
      select: { targetId: true, metadata: true },
    });
    for (const a of adjusts) {
      const m = a.metadata as { manualAdjust?: boolean; exchange?: string; symbol?: string; side?: string; quantity?: number; price?: number | null } | null;
      if (!m?.manualAdjust || !m.exchange || !m.symbol || !m.quantity || !a.targetId) continue;
      const inst = `${m.exchange}:${m.symbol}`;
      const sign = m.side === 'SELL' ? -1 : 1;
      const fm = book.get(a.targetId) ?? new Map<string, { cash: number; net: number; last: number }>();
      const px = m.price ?? this.prices.get(instrumentKey(m.exchange, m.symbol)) ?? fm.get(inst)?.last ?? 0;
      const cur = fm.get(inst) ?? { cash: 0, net: 0, last: px };
      cur.cash -= sign * m.quantity * px;
      cur.net += sign * m.quantity;
      fm.set(inst, cur);
      book.set(a.targetId, fm);
    }
    // Exits done outside the copy engine (client / master "Exit", exit-all, square-off): close the copied net
    // quantity at the exit price, so a closed position stops moving with the LTP.
    if (book.size) {
      const accounts = await this.prisma.brokerAccount.findMany({ where: { userId, mode: 'TRADING' }, select: { id: true } });
      const exits = accounts.length
        ? await this.prisma.auditLog.findMany({
            where: { action: 'COPY_STOPPED', targetType: 'BrokerAccount', targetId: { in: accounts.map((a) => a.id) }, createdAt: { gte: since } },
            select: { metadata: true },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      for (const e of exits) {
        const m = e.metadata as { manualExit?: boolean; exchange?: string; symbol?: string; side?: string; quantity?: number; price?: number | null } | null;
        if (!m?.manualExit || !m.exchange || !m.symbol || !m.quantity) continue;
        const inst = `${m.exchange}:${m.symbol}`;
        const exitSign = m.side === 'BUY' ? 1 : -1; // SELL closes a long (net > 0)
        let left = m.quantity;
        for (const fm of book.values()) {
          const cur = fm.get(inst);
          if (!cur || left <= 0 || cur.net === 0 || Math.sign(cur.net) === exitSign) continue;
          const q = Math.min(left, Math.abs(cur.net));
          const px = m.price ?? this.prices.get(instrumentKey(m.exchange, m.symbol)) ?? cur.last;
          cur.cash -= exitSign * q * px;
          cur.net += exitSign * q;
          left -= q;
        }
      }
    }
    const pnlOf = (followerId: string) => {
      let pnl = 0;
      for (const [inst, v] of book.get(followerId) ?? []) {
        const [ex, sym] = inst.split(':') as [string, string];
        if (v.net) this.feed.ensure(ex as never, sym);
        const ltp = this.prices.get(instrumentKey(ex, sym)) ?? v.last;
        pnl += v.cash + v.net * ltp;
      }
      return Math.round(pnl * 100) / 100;
    };
    const strategies = subs.map((s) => ({
      followerId: s.id,
      strategyId: s.strategyId,
      name: s.strategy.name,
      strategyStatus: s.strategy.status,
      copyStatus: s.copyStatus,
      allocation: allocationLabel(s),
      todayPnl: pnlOf(s.id),
      todayTrades: trades.get(s.id) ?? 0,
    }));
    return { todayPnl: Math.round(strategies.reduce((a, x) => a + x.todayPnl, 0) * 100) / 100, strategies };
  }

  /**
   * Client trade book for today (like a broker's trade history): one row per entry signal with the strategy
   * (algo) name, script, side, entry / exit time and price, quantity, lots and P&L. Exits (master exit, TP/SL,
   * manual exit, square-off) are matched FIFO; lot-multiplier resizes add to / reduce the open row.
   */
  async tradeBook(userId: string) {
    const since = startOfTradingDayIST();
    const subs = await this.prisma.strategyFollower.findMany({ where: { followerUserId: userId }, include: { strategy: { select: { name: true } } } });
    const subName = new Map(subs.map((x) => [x.id, x.strategy.name]));
    const [orders, audits] = await Promise.all([
      this.prisma.copyOrder.findMany({
        where: { followerUserId: userId, createdAt: { gte: since }, filledQuantity: { gt: 0 } },
        include: { masterTrade: { select: { rawPayload: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: {
          createdAt: { gte: since },
          OR: [
            { action: 'PROFILE_UPDATED', targetType: 'StrategyFollower', targetId: { in: subs.map((x) => x.id) } },
            { action: 'COPY_STOPPED', targetType: 'BrokerAccount', targetId: { in: [...new Set(subs.map((x) => x.brokerAccountId).filter(Boolean) as string[])] } },
          ],
        },
        select: { targetId: true, targetType: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    type Row = {
      id: string;
      followerId: string;
      strategyName: string;
      exchange: string;
      symbol: string;
      productType: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      lotSize: number;
      entryPrice: number;
      entryAt: string;
      closedQty: number;
      exitValue: number;
      exitAt: string | null;
    };
    type Ev = { at: number; kind: 'entry' | 'exit' | 'adjust' | 'manualExit'; key: string; followerId?: string; accountId?: string; side: 'BUY' | 'SELL'; qty: number; price: number; id: string; lot: number; ex: string; sym: string; product: string };
    const evs: Ev[] = [];
    for (const o of orders) {
      const lot = (o.masterTrade.rawPayload as { lotSize?: number } | null)?.lotSize ?? 1;
      evs.push({
        at: (o.filledAt ?? o.createdAt).getTime(),
        kind: o.isExit ? 'exit' : 'entry',
        key: `${o.strategyFollowerId}|${o.exchange}:${o.symbol}|${o.productType}`,
        followerId: o.strategyFollowerId,
        side: o.side,
        qty: o.filledQuantity,
        price: o.averagePrice == null ? 0 : Number(o.averagePrice),
        id: o.id,
        lot,
        ex: o.exchange,
        sym: o.symbol,
        product: o.productType,
      });
    }
    for (const a of audits) {
      const m = a.metadata as { manualExit?: boolean; manualAdjust?: boolean; exchange?: string; symbol?: string; productType?: string; side?: string; quantity?: number; price?: number | null } | null;
      if (!m?.exchange || !m.symbol || !m.productType || !a.targetId) continue;
      const px = m.price ?? this.prices.get(instrumentKey(m.exchange, m.symbol)) ?? 0;
      if (m.manualAdjust && a.targetType === 'StrategyFollower' && m.quantity) {
        evs.push({ at: a.createdAt.getTime(), kind: 'adjust', key: `${a.targetId}|${m.exchange}:${m.symbol}|${m.productType}`, followerId: a.targetId, side: m.side === 'SELL' ? 'SELL' : 'BUY', qty: m.quantity, price: px, id: '', lot: 1, ex: m.exchange, sym: m.symbol, product: m.productType });
      } else if (m.manualExit && a.targetType === 'BrokerAccount') {
        evs.push({ at: a.createdAt.getTime(), kind: 'manualExit', key: `*|${m.exchange}:${m.symbol}|${m.productType}`, accountId: a.targetId, side: m.side === 'BUY' ? 'BUY' : 'SELL', qty: m.quantity ?? 0, price: px, id: '', lot: 1, ex: m.exchange, sym: m.symbol, product: m.productType });
      }
    }
    evs.sort((x, y) => x.at - y.at);
    const rows: Row[] = [];
    const openRows = (key: string) => rows.filter((r) => `${r.followerId}|${r.exchange}:${r.symbol}|${r.productType}` === key && r.closedQty < r.quantity);
    const close = (list: Row[], qty: number, price: number, at: number) => {
      let left = qty;
      for (const r of list) {
        if (left <= 0) break;
        const q = Math.min(left, r.quantity - r.closedQty);
        r.closedQty += q;
        r.exitValue += q * price;
        r.exitAt = new Date(at).toISOString();
        left -= q;
      }
    };
    const accountOf = new Map(subs.map((x) => [x.id, x.brokerAccountId]));
    for (const e of evs) {
      if (e.kind === 'entry') {
        const open = openRows(e.key);
        if (open.length && open[0]!.side !== e.side) {
          close(open, e.qty, e.price, e.at); // an opposite entry first closes what is open
          continue;
        }
        rows.push({ id: e.id, followerId: e.followerId!, strategyName: subName.get(e.followerId!) ?? '—', exchange: e.ex, symbol: e.sym, productType: e.product, side: e.side, quantity: e.qty, lotSize: e.lot, entryPrice: e.price, entryAt: new Date(e.at).toISOString(), closedQty: 0, exitValue: 0, exitAt: null });
      } else if (e.kind === 'exit') {
        close(openRows(e.key), e.qty, e.price, e.at);
      } else if (e.kind === 'adjust') {
        const open = openRows(e.key);
        const last = open[open.length - 1];
        if (!last) continue;
        if (last.side === e.side) {
          last.entryPrice = (last.entryPrice * last.quantity + e.price * e.qty) / (last.quantity + e.qty);
          last.quantity += e.qty;
        } else close(open, e.qty, e.price, e.at);
      } else {
        // manual exit of the whole account position: close every open row of this contract on that account
        for (const r of rows) {
          if (accountOf.get(r.followerId) === e.accountId && r.exchange === e.ex && r.symbol === e.sym && r.productType === e.product && r.closedQty < r.quantity) {
            close([r], r.quantity - r.closedQty, e.price, e.at);
          }
        }
      }
    }
    const out = rows.map((r) => {
      const dir = r.side === 'BUY' ? 1 : -1;
      const openQty = r.quantity - r.closedQty;
      const exitPrice = r.closedQty ? r.exitValue / r.closedQty : null;
      if (openQty) this.feed.ensure(r.exchange as never, r.symbol);
      const ltp = openQty ? (this.prices.get(instrumentKey(r.exchange, r.symbol)) ?? r.entryPrice) : null;
      const pnl = (exitPrice != null ? (exitPrice - r.entryPrice) * r.closedQty * dir : 0) + (ltp != null ? (ltp - r.entryPrice) * openQty * dir : 0);
      return {
        id: r.id,
        strategyName: r.strategyName,
        exchange: r.exchange,
        symbol: r.symbol,
        productType: r.productType,
        side: r.side,
        quantity: r.quantity,
        lots: r.lotSize > 1 ? +(r.quantity / r.lotSize).toFixed(2) : null,
        openQuantity: openQty,
        entryPrice: Math.round(r.entryPrice * 100) / 100,
        entryAt: r.entryAt,
        exitPrice: exitPrice == null ? null : Math.round(exitPrice * 100) / 100,
        exitAt: openQty ? null : r.exitAt,
        ltp,
        status: openQty ? ('OPEN' as const) : ('CLOSED' as const),
        pnl: Math.round(pnl * 100) / 100,
      };
    });
    out.reverse(); // newest first
    return { totalPnl: Math.round(out.reduce((a, r) => a + r.pnl, 0) * 100) / 100, rows: out };
  }
}
