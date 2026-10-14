import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { PrismaClient } from '@ctp/database';
import { AuditService } from '../audit/audit.service';
import { clientInfo } from '../common/client-info';
import { CurrentUser, RequestUser, Roles } from '../common/decorators/auth.decorators';
import { toCopyOrderView, toStrategyFollowerView, toStrategyView } from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { ExitPositionDto, FollowDto } from './trading.dto';
import { BrokerApiError } from '../brokers/broker-http';
import { MarketFeedService } from '../market-data/market-feed.service';
import { instrumentKey, PriceCacheService } from '../market-data/price-cache.service';
import { startOfTradingDayIST } from '../admin/admin.service';
import { overlayLivePrices, paperPositionView } from './price-overlay';
import { TradingService } from './trading.service';
import { RiskService } from './risk.service';
import { AccountEvents } from '../realtime/account-events';

/** Client (follower) side: discover strategies, subscribe, start/stop copying, and see own portfolio. */
@Roles('FOLLOWER')
@Controller('follow')
export class FollowerController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly trading: TradingService,
    private readonly audit: AuditService,
    private readonly risk: RiskService,
    private readonly accountEvents: AccountEvents,
    private readonly prices: PriceCacheService,
    private readonly feed: MarketFeedService,
  ) {}

  /**
   * Client dashboard: today's P&L (overall and per strategy), connected broker, subscriptions and licence.
   * P&L is computed from today's executed copy orders (sells − buys) plus the open quantity at the live LTP.
   */
  @Get('dashboard')
  async dashboard(@CurrentUser() user: RequestUser) {
    const since = startOfTradingDayIST();
    const [me, accounts, subs, orders] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: { licenceExpiresAt: true, licenceDays: true } }),
      this.prisma.brokerAccount.findMany({ where: { userId: user.id, broker: { not: 'MOCK' } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.strategyFollower.findMany({ where: { followerUserId: user.id }, include: { strategy: { select: { name: true, status: true } } } }),
      this.prisma.copyOrder.findMany({
        where: { followerUserId: user.id, createdAt: { gte: since }, filledQuantity: { gt: 0 } },
        select: { strategyFollowerId: true, exchange: true, symbol: true, side: true, filledQuantity: true, averagePrice: true },
      }),
    ]);
    // Per strategy & instrument: cash flow and net quantity.
    const book = new Map<string, Map<string, { cash: number; net: number; last: number }>>();
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
      allocation:
        s.allocationMode === 'FIXED_QUANTITY'
          ? s.fixedLots
            ? `${s.fixedLots} lot${s.fixedLots > 1 ? 's' : ''}`
            : `${s.fixedQuantity ?? 0} qty`
          : s.allocationMode === 'CAPITAL_PERCENTAGE'
            ? `${Number(s.allocationPercent ?? 0)}%`
            : `₹${Number(s.allocationAmount ?? 0).toLocaleString('en-IN')}`,
      todayPnl: pnlOf(s.id),
    }));
    const now = Date.now();
    const exp = me?.licenceExpiresAt?.getTime() ?? null;
    const primary = accounts.find((a) => a.status === 'CONNECTED') ?? accounts[0] ?? null;
    return {
      todayPnl: Math.round(strategies.reduce((s, x) => s + x.todayPnl, 0) * 100) / 100,
      broker: primary
        ? {
            broker: primary.broker,
            brokerClientId: primary.brokerClientId,
            status: primary.status,
            connected: primary.status === 'CONNECTED' && (!primary.tokenExpiresAt || primary.tokenExpiresAt.getTime() > now),
            tradingMode: this.trading.isSimulated(primary) ? 'PAPER' : 'LIVE',
          }
        : null,
      subscriptions: {
        total: subs.length,
        on: subs.filter((s) => s.copyStatus === 'ON').length,
        off: subs.filter((s) => s.copyStatus === 'OFF').length,
        paused: subs.filter((s) => s.copyStatus === 'PAUSED').length,
      },
      licence: {
        expiresAt: me?.licenceExpiresAt?.toISOString() ?? null,
        days: me?.licenceDays ?? null,
        remainingDays: exp == null ? null : Math.max(0, Math.ceil((exp - now) / 86_400_000)),
        active: exp == null ? null : exp > now,
      },
      strategies,
    };
  }

  @Get('strategies')
  async strategies(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.strategy.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] } },
      include: { master: { select: { name: true } }, _count: { select: { followers: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const mine = await this.prisma.strategyFollower.findMany({ where: { followerUserId: user.id } });
    const byStrategy = new Map(mine.map((m) => [m.strategyId, m]));
    return rows.map((s) => {
      const sub = byStrategy.get(s.id);
      return { ...toStrategyView(s), subscription: sub ? toStrategyFollowerView(sub) : null };
    });
  }

  @Get('subscriptions')
  async subscriptions(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.strategyFollower.findMany({
      where: { followerUserId: user.id },
      include: { strategy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toStrategyFollowerView);
  }

  /** Subscribe to a strategy or update the allocation. Copying stays OFF until started explicitly. */
  @Post('strategies/:id')
  async follow(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: FollowDto, @Req() req: Request) {
    const s = await this.prisma.strategy.findUnique({ where: { id }, include: { _count: { select: { followers: true } } } });
    if (!s || s.status === 'ARCHIVED' || s.status === 'DRAFT') throw new NotFoundException('Strategy not available');
    const account = await this.prisma.brokerAccount.findFirst({ where: { id: dto.brokerAccountId, userId: user.id } });
    if (!account) throw new BadRequestException('Choose one of your broker accounts');
    if (account.mode === 'DATA_ONLY') throw new BadRequestException('This account is a data-only (master) account and cannot receive orders.');
    if (dto.allocationMode === 'FIXED_QUANTITY' && !dto.fixedQuantity && !dto.fixedLots) throw new BadRequestException('Fixed quantity or fixed lots is required');
    if (dto.allocationMode === 'CAPITAL_PERCENTAGE' && !dto.allocationPercent) throw new BadRequestException('Allocation % is required');
    if (dto.allocationMode === 'PROPORTIONAL' && !dto.allocationAmount) throw new BadRequestException('Capital amount is required');
    const existing = await this.prisma.strategyFollower.findUnique({ where: { strategyId_followerUserId: { strategyId: id, followerUserId: user.id } } });
    if (!existing && s.maxFollowers && s._count.followers >= s.maxFollowers) throw new BadRequestException('This strategy is full');
    const data = {
      brokerAccountId: account.id,
      allocationMode: dto.allocationMode,
      allocationAmount: dto.allocationAmount ?? null,
      allocationPercent: dto.allocationPercent ?? null,
      fixedQuantity: dto.fixedQuantity ?? null,
      fixedLots: dto.fixedLots ?? null,
      maxLots: dto.maxLots ?? null,
      maxQuantity: dto.maxQuantity ?? null,
      maxTradeValue: dto.maxTradeValue ?? null,
      maxDailyLoss: dto.maxDailyLoss ?? null,
      maxTradesPerDay: dto.maxTradesPerDay ?? null,
      allowedSegments: dto.allowedSegments ?? [],
    };
    const row = await this.prisma.strategyFollower.upsert({
      where: { strategyId_followerUserId: { strategyId: id, followerUserId: user.id } },
      create: { strategyId: id, followerUserId: user.id, ...data },
      update: data,
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({ action: 'PROFILE_UPDATED', actorUserId: user.id, targetType: 'StrategyFollower', targetId: row.id, metadata: { strategyId: id, ...dto }, client: clientInfo(req) });
    this.accountEvents.emit({ type: 'settings', brokerAccountId: account.id, userId: user.id });
    return toStrategyFollowerView(row);
  }

  @HttpCode(HttpStatus.OK)
  @Post('subscriptions/:id/:action')
  async toggle(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('action') action: string, @Req() req: Request) {
    if (action !== 'start' && action !== 'stop') throw new NotFoundException();
    const sub = await this.prisma.strategyFollower.findFirst({ where: { id, followerUserId: user.id }, include: { brokerAccount: true } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (action === 'start') {
      const a = sub.brokerAccount;
      if (!a) throw new BadRequestException('Select a broker account first');
      if (a.broker !== 'MOCK' && a.status !== 'CONNECTED') throw new BadRequestException('Your broker is not connected — log in to your broker first.');
      if (a.mode === 'DATA_ONLY') throw new BadRequestException('A data-only (master) account cannot be used for copy trading.');
    }
    const row = await this.prisma.strategyFollower.update({
      where: { id },
      data:
        action === 'start'
          ? { copyStatus: 'ON', startedAt: new Date(), stoppedAt: null, stoppedReason: null }
          : { copyStatus: 'OFF', stoppedAt: new Date(), stoppedReason: 'Stopped by client', stoppedByUserId: user.id },
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({ action: action === 'start' ? 'COPY_STARTED' : 'COPY_STOPPED', actorUserId: user.id, targetType: 'StrategyFollower', targetId: id, client: clientInfo(req) });
    this.accountEvents.emit({ type: 'settings', brokerAccountId: sub.brokerAccountId ?? '', userId: user.id });
    return toStrategyFollowerView(row);
  }

  /** Personal kill switch: stop all my copying and exit all my open positions (MARKET). */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('exit-all')
  async exitAll(@CurrentUser() user: RequestUser) {
    const results = await this.risk.exitAllForUser(user.id);
    return { orders: results.reduce((s, r) => s + r.orders, 0), failed: results.reduce((s, r) => s + r.failed, 0), results };
  }

  /** Exit one of my running positions (MARKET, full broker quantity). */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('positions/exit')
  async exitPosition(@CurrentUser() user: RequestUser, @Body() dto: ExitPositionDto) {
    const account = await this.prisma.brokerAccount.findFirst({ where: { id: dto.accountId, userId: user.id } });
    if (!account) throw new NotFoundException('Broker account not found');
    try {
      return await this.risk.exitPosition(account, dto, user.id);
    } catch (err) {
      if (err instanceof BrokerApiError) throw new BadRequestException(await this.trading.handleBrokerError(account, err));
      throw err;
    }
  }

  // ------------------------------------------------------------- portfolio

  @Get('portfolio')
  async portfolio(@CurrentUser() user: RequestUser) {
    const [live, paper, copyOrders] = await Promise.all([
      this.trading.liveData(user.id),
      this.prisma.position.findMany({ where: { userId: user.id, isPaper: true }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.copyOrder.findMany({ where: { followerUserId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return {
      paperMode: this.trading.isSimulated({ broker: 'ZERODHA', isPaper: false }),
      live: overlayLivePrices(live, this.prices, this.feed),
      paperPositions: paper.map((p) => paperPositionView(p, this.prices, this.feed)),
      copyOrders: copyOrders.map(toCopyOrderView),
    };
  }
}
