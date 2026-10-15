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
}
