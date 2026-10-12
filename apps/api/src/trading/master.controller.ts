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
import { MasterOrderDto, StrategyDto, StrategyStatusDto } from './trading.dto';
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

  /** Live broker data of one of this master's followers (positions, holdings, orders, funds). */
  @Get('clients/:userId/live')
  async clientLive(@CurrentUser() user: RequestUser, @Param('userId') userId: string) {
    const link = await this.prisma.strategyFollower.findFirst({ where: { followerUserId: userId, strategy: { masterUserId: user.id } } });
    if (!link) throw new ForbiddenException('This client does not follow any of your strategies');
    const [live, paper] = await Promise.all([
      this.trading.liveData(userId),
      this.prisma.position.findMany({ where: { userId, isPaper: true }, orderBy: { updatedAt: 'desc' } }),
    ]);
    return { live, paperPositions: paper.map((p) => ({ ...p, averagePrice: p.averagePrice.toString(), lastPrice: p.lastPrice?.toString() ?? null, realizedPnl: p.realizedPnl.toString(), unrealizedPnl: p.unrealizedPnl.toString() })) };
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
      : (accounts.find((a) => a.broker !== 'MOCK' && a.status === 'CONNECTED') ?? accounts.find((a) => a.broker === 'MOCK'));
    if (!account) throw new BadRequestException('Connect a broker account first.');

    const simulated = this.trading.isSimulated(account);
    let price = dto.price ?? null;
    if (price == null) {
      const real = account.broker !== 'MOCK' && account.status === 'CONNECTED' ? account : accounts.find((a) => a.broker !== 'MOCK' && a.status === 'CONNECTED');
      if (real) price = await (await this.trading.adapterFor(real)).ltp(dto.exchange, dto.symbol).catch(() => null);
    }
    if (simulated && price == null) throw new BadRequestException('Live price unavailable — enter a price for this paper trade.');

    let brokerOrderId: string;
    try {
      if (simulated) {
        brokerOrderId = `PAPER-${generateToken(9)}`;
      } else {
        ({ brokerOrderId } = await (await this.trading.adapterFor(account)).placeOrder({ ...dto, tag: 'ctpmaster' }));
        await this.poller.markSeen(account.id, brokerOrderId);
      }
    } catch (err) {
      if (err instanceof BrokerApiError) throw new BadRequestException(await this.trading.handleBrokerError(account, err));
      throw err;
    }
    if (simulated) await this.engine.applyPaperFill(user.id, account.id, dto, dto.quantity, price ?? 0);

    const trade = await this.engine.onMasterTrade(strategy, account, {
      ...dto,
      brokerOrderId,
      filledQuantity: simulated ? dto.quantity : 0,
      averagePrice: simulated ? price : null,
      price,
      status: simulated ? 'FILLED' : 'SUBMITTED',
      timestamp: new Date(),
      lotSize: dto.lotSize,
    });
    return this.trade(user, trade!.id);
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
      live,
      paperPositions: paper.map((p) => ({ ...p, averagePrice: p.averagePrice.toString(), lastPrice: p.lastPrice?.toString() ?? null, realizedPnl: p.realizedPnl.toString(), unrealizedPnl: p.unrealizedPnl.toString() })),
    };
  }

  @Get('ltp')
  async ltp(@CurrentUser() user: RequestUser, @Query('exchange') exchange: string, @Query('symbol') symbol: string) {
    const acc = await this.prisma.brokerAccount.findFirst({ where: { userId: user.id, status: 'CONNECTED', broker: { not: 'MOCK' } }, orderBy: { broker: 'asc' } });
    if (!acc || !exchange || !symbol) return { ltp: null };
    const ad = await this.trading.adapterFor(acc).catch(() => null);
    return { ltp: ad ? await ad.ltp(exchange.toUpperCase() as never, symbol.toUpperCase()).catch(() => null) : null };
  }
}
