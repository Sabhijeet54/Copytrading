import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { PrismaClient } from '@ctp/database';
import { AuditService } from '../audit/audit.service';
import { clientInfo } from '../common/client-info';
import { CurrentUser, RequestUser, Roles } from '../common/decorators/auth.decorators';
import { toCopyOrderView, toStrategyFollowerView, toStrategyView } from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { ExitPositionDto, FollowDto, TradingModeDto } from './trading.dto';
import { allocationLabel, ClientSummaryService, isRemoved } from './client-summary.service';
import { BrokerApiError } from '../brokers/broker-http';
import { MarketFeedService } from '../market-data/market-feed.service';
import { PriceCacheService } from '../market-data/price-cache.service';
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
    private readonly summary: ClientSummaryService,
  ) {}

  /**
   * Client dashboard: today's P&L (overall and per strategy), connected broker, subscriptions and licence.
   * P&L is computed from today's executed copy orders (sells − buys) plus the open quantity at the live LTP.
   */
  @Get('dashboard')
  async dashboard(@CurrentUser() user: RequestUser) {
    const [me, accounts, day] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: { licenceExpiresAt: true, licenceDays: true, licenceAssignedAt: true } }),
      this.prisma.brokerAccount.findMany({ where: { userId: user.id, broker: { not: 'MOCK' }, mode: 'TRADING' }, orderBy: { updatedAt: 'desc' } }),
      this.summary.today(user.id),
    ]);
    const subs = day.strategies;
    const now = Date.now();
    const exp = me?.licenceExpiresAt?.getTime() ?? null;
    const primary = accounts.find((a) => a.status === 'CONNECTED') ?? accounts[0] ?? null;
    const paperForced = this.trading.isSimulated({ broker: 'ZERODHA', isPaper: false });
    return {
      todayPnl: day.todayPnl,
      broker: primary
        ? {
            accountId: primary.id,
            broker: primary.broker,
            brokerClientId: primary.brokerClientId,
            status: primary.status,
            connected: primary.status === 'CONNECTED' && (!primary.tokenExpiresAt || primary.tokenExpiresAt.getTime() > now),
            tradingMode: this.trading.isSimulated(primary) ? 'PAPER' : 'LIVE',
            /** true = the server runs with PAPER_MODE=true: nobody can switch to live. */
            paperForced,
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
        assignedAt: me?.licenceAssignedAt?.toISOString() ?? null,
        days: me?.licenceDays ?? null,
        remainingDays: exp == null ? null : Math.max(0, Math.ceil((exp - now) / 86_400_000)),
        active: exp == null ? null : exp > now,
      },
      strategies: subs,
    };
  }

  /**
   * Paper / live switch for my trading account. Paper = copied trades are simulated, no real broker orders.
   * Live is impossible while the server runs with PAPER_MODE=true.
   */
  @HttpCode(HttpStatus.OK)
  @Post('trading-mode')
  async tradingMode(@CurrentUser() user: RequestUser, @Body() dto: TradingModeDto, @Req() req: Request) {
    if (dto.mode === 'LIVE' && this.trading.isSimulated({ broker: 'ZERODHA', isPaper: false })) {
      throw new BadRequestException('Live trading is switched off on this platform (paper mode). Ask your admin to enable live trading.');
    }
    const accounts = await this.prisma.brokerAccount.findMany({ where: { userId: user.id, broker: { not: 'MOCK' }, mode: 'TRADING' } });
    if (!accounts.length) throw new BadRequestException('Connect your broker first.');
    await this.prisma.brokerAccount.updateMany({ where: { id: { in: accounts.map((a) => a.id) } }, data: { isPaper: dto.mode === 'PAPER' } });
    await this.audit.log({ action: 'PROFILE_UPDATED', actorUserId: user.id, targetType: 'BrokerAccount', targetId: accounts[0]!.id, metadata: { tradingMode: dto.mode }, client: clientInfo(req) });
    for (const a of accounts) this.accountEvents.emit({ type: 'settings', brokerAccountId: a.id, userId: user.id });
    return { mode: dto.mode };
  }

  /** Only the strategies an admin / master assigned to me. */
  @Get('strategies')
  async strategies(@CurrentUser() user: RequestUser) {
    const mine = (await this.prisma.strategyFollower.findMany({ where: { followerUserId: user.id } })).filter((m) => !isRemoved(m));
    if (!mine.length) return [];
    const rows = await this.prisma.strategy.findMany({
      where: { id: { in: mine.map((m) => m.strategyId) }, status: { in: ['ACTIVE', 'PAUSED'] } },
      include: { master: { select: { name: true } }, _count: { select: { followers: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const byStrategy = new Map(mine.map((m) => [m.strategyId, m]));
    return rows.map((s) => {
      const sub = byStrategy.get(s.id);
      return { ...toStrategyView(s), subscription: sub ? toStrategyFollowerView(sub) : null, allocationLabel: sub ? allocationLabel(sub) : null };
    });
  }

  @Get('subscriptions')
  async subscriptions(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.strategyFollower.findMany({
      where: { followerUserId: user.id },
      include: { strategy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((r) => !isRemoved(r)).map(toStrategyFollowerView);
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
    // A client can only trade strategies that an admin / master assigned to him.
    if (!existing || isRemoved(existing)) throw new BadRequestException('This strategy is not assigned to you — contact your admin.');
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
    if (action === 'start' && isRemoved(sub)) throw new BadRequestException('This strategy is no longer assigned to you.');
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

  /**
   * My positions, holdings and orders. Platform history (copied trades, closed paper positions) is shown for
   * TODAY only (IST trading day) — it starts empty every morning. Holdings come straight from the broker.
   */
  @Get('portfolio')
  async portfolio(@CurrentUser() user: RequestUser) {
    const since = startOfTradingDayIST();
    const [live, paper, copyOrders, day] = await Promise.all([
      this.trading.liveData(user.id),
      this.prisma.position.findMany({
        where: { userId: user.id, isPaper: true, OR: [{ quantity: { not: 0 } }, { updatedAt: { gte: since } }] },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.copyOrder.findMany({
        where: { followerUserId: user.id, createdAt: { gte: since } },
        include: { strategyFollower: { select: { strategy: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.summary.today(user.id),
    ]);
    return {
      paperMode: this.trading.isSimulated({ broker: 'ZERODHA', isPaper: false }),
      todayPnl: day.todayPnl,
      live: overlayLivePrices(live, this.prices, this.feed),
      paperPositions: paper.map((p) => paperPositionView(p, this.prices, this.feed)),
      copyOrders: copyOrders.map((c) => ({ ...toCopyOrderView(c), strategyName: c.strategyFollower.strategy.name })),
    };
  }
}
