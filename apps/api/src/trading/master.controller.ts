import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type Redis from 'ioredis';
import type { PrismaClient, Strategy } from '@ctp/database';
import { generateToken } from '@ctp/shared';
import { AuditService } from '../audit/audit.service';
import { clientInfo } from '../common/client-info';
import { CurrentUser, RequestUser, Roles } from '../common/decorators/auth.decorators';
import { toBrokerAccountView, toCopyOrderView, toMasterTradeView, toStrategyFollowerView, toStrategyView } from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { REDIS } from '../common/redis/redis.module';
import { BrokerApiError } from '../brokers/broker-http';
import { CopyEngineService } from './copy-engine.service';
import { MasterPollerService } from './master-poller.service';
import { RiskService } from './risk.service';
import { AccountEvents } from '../realtime/account-events';
import { MarketFeedService } from '../market-data/market-feed.service';
import { instrumentKey, PriceCacheService } from '../market-data/price-cache.service';
import { AssignClientDto, ExitPositionDto, MasterOrderDto, StrategyDto, StrategyStatusDto } from './trading.dto';
import { ClientAssignService } from './client-assign.service';
import { overlayLivePrices, paperPositionView } from './price-overlay';
import { TradingService } from './trading.service';

/** Everything a master trader needs: strategies, followers, live account data and trade placement. */
@Roles('MASTER')
@Controller('master')
export class MasterController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly trading: TradingService,
    private readonly engine: CopyEngineService,
    private readonly poller: MasterPollerService,
    private readonly audit: AuditService,
    private readonly risk: RiskService,
    private readonly accountEvents: AccountEvents,
    private readonly prices: PriceCacheService,
    private readonly feed: MarketFeedService,
    private readonly assigner: ClientAssignService,
  ) {}

  private async own(user: RequestUser, id: string): Promise<Strategy> {
    const s = await this.prisma.strategy.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Strategy not found');
    if (s.masterUserId !== user.id) throw new ForbiddenException('Not your strategy');
    return s;
  }

  // ------------------------------------------------------------ strategies

  @Get('strategies')
  async strategies(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.strategy.findMany({
      where: { masterUserId: user.id, status: { not: 'ARCHIVED' } },
      include: { _count: { select: { followers: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const active = await this.prisma.strategyFollower.groupBy({
      by: ['strategyId'],
      where: { strategyId: { in: rows.map((r) => r.id) }, copyStatus: 'ON' },
      _count: true,
    });
    const activeMap = new Map(active.map((a) => [a.strategyId, a._count]));
    return rows.map((r) => toStrategyView(r, activeMap.get(r.id) ?? 0));
  }

  @Post('strategies')
  async create(@CurrentUser() user: RequestUser, @Body() dto: StrategyDto, @Req() req: Request) {
    const s = await this.prisma.strategy.create({
      data: {
        masterUserId: user.id,
        name: dto.name,
        description: dto.description,
        riskLevel: dto.riskLevel ?? 'MEDIUM',
        allowedExchanges: dto.allowedExchanges ?? [],
        allowedInstruments: (dto.allowedInstruments ?? []).map((x) => x.toUpperCase()),
        maxFollowers: dto.maxFollowers,
        masterCapital: dto.masterCapital,
        maxOrderValue: dto.maxOrderValue,
        maxQuantityPerOrder: dto.maxQuantityPerOrder,
      },
    });
    await this.audit.log({ action: 'STRATEGY_CREATED', actorUserId: user.id, targetType: 'Strategy', targetId: s.id, client: clientInfo(req) });
    return toStrategyView(s);
  }

  @Patch('strategies/:id')
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: StrategyDto, @Req() req: Request) {
    await this.own(user, id);
    const s = await this.prisma.strategy.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description ?? null,
        riskLevel: dto.riskLevel,
        allowedExchanges: dto.allowedExchanges,
        allowedInstruments: dto.allowedInstruments?.map((x) => x.toUpperCase()),
        maxFollowers: dto.maxFollowers ?? null,
        masterCapital: dto.masterCapital,
        maxOrderValue: dto.maxOrderValue ?? null,
        maxQuantityPerOrder: dto.maxQuantityPerOrder ?? null,
      },
    });
    await this.audit.log({ action: 'STRATEGY_UPDATED', actorUserId: user.id, targetType: 'Strategy', targetId: id, client: clientInfo(req) });
    return toStrategyView(s);
  }

  @HttpCode(HttpStatus.OK)
  @Post('strategies/:id/status')
  async setStatus(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: StrategyStatusDto, @Req() req: Request) {
    await this.own(user, id);
    const s = await this.prisma.strategy.update({ where: { id }, data: { status: dto.status } });
    if (dto.status === 'ACTIVE') {
      // Re-baseline the master's order books so orders placed before activation are never copied.
      const accounts = await this.prisma.brokerAccount.findMany({ where: { userId: user.id }, select: { id: true } });
      if (accounts.length) await this.redis.del(...accounts.map((a) => `ctp:poll:seen:${a.id}`));
    }
    this.accountEvents.emit({ type: 'settings', brokerAccountId: '', userId: user.id });
    await this.audit.log({
      action: dto.status === 'ACTIVE' ? 'STRATEGY_STARTED' : dto.status === 'PAUSED' ? 'STRATEGY_STOPPED' : 'STRATEGY_UPDATED',
      actorUserId: user.id,
      targetType: 'Strategy',
      targetId: id,
      metadata: { status: dto.status },
      client: clientInfo(req),
    });
    return toStrategyView(s);
  }

  // ------------------------------------------------------------- followers

  @Get('strategies/:id/followers')
  async followers(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.own(user, id);
    const rows = await this.prisma.strategyFollower.findMany({
      where: { strategyId: id },
      include: { follower: { select: { name: true, email: true, mobile: true } }, brokerAccount: true },
      orderBy: { createdAt: 'desc' },
    });
    const pnl = await this.prisma.position.groupBy({
      by: ['userId'],
      where: { userId: { in: rows.map((r) => r.followerUserId) } },
      _sum: { realizedPnl: true, unrealizedPnl: true },
    });
    const pnlMap = new Map(pnl.map((p) => [p.userId, p._sum]));
    return rows.map((r) => ({
      ...toStrategyFollowerView(r),
      followerEmail: r.follower.email,
      followerMobile: r.follower.mobile,
      brokerAccount: r.brokerAccount ? toBrokerAccountView(r.brokerAccount) : null,
      paperRealizedPnl: pnlMap.get(r.followerUserId)?.realizedPnl?.toString() ?? '0',
      paperUnrealizedPnl: pnlMap.get(r.followerUserId)?.unrealizedPnl?.toString() ?? '0',
    }));
  }

  /** Assign a client (by email) to one of my strategies, with allocation; optionally start copying right away. */
  @HttpCode(HttpStatus.OK)
  @Post('strategies/:id/assign')
  async assign(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: AssignClientDto) {
    const s = await this.own(user, id);
    const { follower, warning } = await this.assigner.assign(s, dto, user.id);
    return { follower: toStrategyFollowerView(follower), warning };
  }

  /** Remove a client from one of my strategies (copying stops; open positions are left as they are). */
  @HttpCode(HttpStatus.OK)
  @Post('strategies/:id/followers/:followerId/remove')
  async unassign(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('followerId') followerId: string) {
    await this.own(user, id);
    return toStrategyFollowerView(await this.assigner.unassign(id, followerId, user.id));
  }

  /** Exit one running position of one of my clients (MARKET, full broker quantity). */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('clients/:userId/positions/exit')
  async exitClientPosition(@CurrentUser() user: RequestUser, @Param('userId') userId: string, @Body() dto: ExitPositionDto) {
    const link = await this.prisma.strategyFollower.findFirst({ where: { followerUserId: userId, strategy: { masterUserId: user.id } } });
    if (!link) throw new ForbiddenException('This client does not follow any of your strategies');
    const account = await this.prisma.brokerAccount.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('Broker account not found for this client');
    try {
      return await this.risk.exitPosition(account, dto, user.id);
    } catch (err) {
      if (err instanceof BrokerApiError) throw new BadRequestException(await this.trading.handleBrokerError(account, err));
      throw err;
    }
  }

  /** Live broker data of one of this master's followers (positions, holdings, orders, funds). */
  @Get('clients/:userId/live')
  async clientLive(@CurrentUser() user: RequestUser, @Param('userId') userId: string) {
    const link = await this.prisma.strategyFollower.findFirst({ where: { followerUserId: userId, strategy: { masterUserId: user.id } } });
    if (!link) throw new ForbiddenException('This client does not follow any of your strategies');
    const [live, paper] = await Promise.all([
      this.trading.liveData(userId),
      this.prisma.position.findMany({ where: { userId, isPaper: true }, orderBy: { updatedAt: 'desc' } }),
    ]);
    return { live: overlayLivePrices(live, this.prices, this.feed), paperPositions: paper.map((p) => paperPositionView(p, this.prices, this.feed)) };
  }

  // ---------------------------------------------------------------- trades

  @Get('trades')
  async trades(@CurrentUser() user: RequestUser, @Query('strategyId') strategyId?: string) {
    const rows = await this.prisma.masterTrade.findMany({
      where: { masterUserId: user.id, ...(strategyId ? { strategyId } : {}) },
      include: { _count: { select: { copyOrders: true } }, copyOrders: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((t) => {
      const counts: Record<string, number> = {};
      for (const c of t.copyOrders) counts[c.status] = (counts[c.status] ?? 0) + 1;
      return { ...toMasterTradeView(t), copyStatusCounts: counts };
    });
  }

  @Get('trades/:id')
  async trade(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const t = await this.prisma.masterTrade.findFirst({
      where: { id, masterUserId: user.id },
      include: { copyOrders: { include: { follower: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } },
    });
    if (!t) throw new NotFoundException('Trade not found');
    return { ...toMasterTradeView(t), copyOrders: t.copyOrders.map(toCopyOrderView) };
  }

  /** Places an order on the master's account (or simulates it in paper mode) and copies it to all active followers. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('orders')
  async placeOrder(@CurrentUser() user: RequestUser, @Body() dto: MasterOrderDto) {
    const strategy = await this.own(user, dto.strategyId);
    if (strategy.status !== 'ACTIVE') throw new BadRequestException('Start (activate) the strategy before trading it.');
    if (strategy.allowedExchanges.length && !strategy.allowedExchanges.includes(dto.exchange)) {
      throw new BadRequestException(`${dto.exchange} is not allowed in this strategy.`);
    }
    if (strategy.allowedInstruments.length) {
      const ok = strategy.allowedInstruments.some((p) => (p.endsWith('*') ? dto.symbol.startsWith(p.slice(0, -1)) : dto.symbol === p));
      if (!ok) throw new BadRequestException(`${dto.symbol} is not allowed in this strategy.`);
    }
    if ((dto.orderType === 'LIMIT' || dto.orderType === 'SL') && !dto.price) throw new BadRequestException('Price is required for LIMIT / SL orders.');
    if ((dto.orderType === 'SL' || dto.orderType === 'SL_M') && !dto.triggerPrice) throw new BadRequestException('Trigger price is required for SL orders.');

    const accounts = await this.prisma.brokerAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    const account = dto.brokerAccountId
      ? accounts.find((a) => a.id === dto.brokerAccountId)
      : (accounts.find((a) => a.broker !== 'MOCK' && a.status === 'CONNECTED') ?? accounts.find((a) => a.broker === 'MOCK') ?? accounts[0]);
    if (!account) throw new BadRequestException('Connect a broker account first.');

    // The master's broker account is DATA_ONLY: the platform NEVER places orders on it. A master order from the
    // platform is a SIGNAL that is mirrored to the followers only.
    const isSignal = account.mode === 'DATA_ONLY' || this.trading.isSimulated(account);
    const price = dto.price ?? this.prices.get(instrumentKey(dto.exchange, dto.symbol)) ?? null;
    this.feed.ensure(dto.exchange, dto.symbol);
    if (this.trading.isSimulated(account) && price == null) throw new BadRequestException('Live price unavailable — enter a price for this paper trade.');

    let brokerOrderId: string;
    if (isSignal) {
      brokerOrderId = `SIG-${generateToken(9)}`;
    } else {
      try {
        this.trading.assertOrderAllowed(account);
        ({ brokerOrderId } = await (await this.trading.adapterFor(account)).placeOrder({ ...dto, tag: 'ctpmaster' }));
        await this.poller.markSeen(account.id, brokerOrderId);
      } catch (err) {
        if (err instanceof BrokerApiError) throw new BadRequestException(await this.trading.handleBrokerError(account, err));
        throw err;
      }
    }
    // Signal book: the master's own (virtual) position, for display.
    if (isSignal && price != null) await this.engine.applyPaperFill(user.id, account.id, dto, dto.quantity, price);

    const summary = await this.engine.onMasterTrade(strategy, account, {
      ...dto,
      brokerOrderId,
      filledQuantity: isSignal ? dto.quantity : 0,
      averagePrice: isSignal ? price : null,
      price,
      status: isSignal ? 'FILLED' : 'SUBMITTED',
      timestamp: new Date(),
      lotSize: dto.lotSize,
    });
    if (!summary) throw new BadRequestException('Duplicate order ignored.');
    return { ...(await this.trade(user, summary.tradeId)), fanOutMs: summary.totalMs };
  }

  /** Exits every follower's open copy positions of this strategy (MARKET). */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('strategies/:id/exit-all')
  async exitAll(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.own(user, id);
    const results = await this.risk.exitStrategy(id);
    return { orders: results.reduce((s, r) => s + r.orders, 0), failed: results.reduce((s, r) => s + r.failed, 0), results };
  }

  /** Average copy latency (ms) for the dashboard. */
  @Get('latency')
  async latency() {
    return this.engine.latency.snapshot();
  }

  // ------------------------------------------------------------------ live

  @Get('live')
  async live(@CurrentUser() user: RequestUser) {
    const [live, paper, accounts] = await Promise.all([
      this.trading.liveData(user.id),
      this.prisma.position.findMany({ where: { userId: user.id, isPaper: true }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.brokerAccount.findMany({ where: { userId: user.id } }),
    ]);
    return {
      paperMode: this.trading.isSimulated({ broker: 'ZERODHA', isPaper: false }),
      accounts: accounts.map(toBrokerAccountView),
      live: overlayLivePrices(live, this.prices, this.feed),
      paperPositions: paper.map((p) => paperPositionView(p, this.prices, this.feed)),
    };
  }

  /** LTP from the live price cache (fed by the master feed) — never a broker quote call. */
  @Get('ltp')
  async ltp(@Query('exchange') exchange: string, @Query('symbol') symbol: string) {
    if (!exchange || !symbol) return { ltp: null };
    this.feed.ensure(exchange.toUpperCase() as never, symbol.toUpperCase());
    const tick = this.prices.getTick(instrumentKey(exchange, symbol));
    return { ltp: tick?.ltp ?? null, ts: tick ? new Date(tick.ts).toISOString() : null };
  }
}
