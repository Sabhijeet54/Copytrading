import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { CopyOrder, PrismaClient } from '@ctp/database';
import { AuditService } from '../audit/audit.service';
import { clientInfo } from '../common/client-info';
import { CurrentUser, RequestUser, Roles } from '../common/decorators/auth.decorators';
import { toCopyOrderView, toStrategyFollowerView, toStrategyView } from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { FollowDto, TradingModeDto } from './trading.dto';
import { allocationLabel, ClientSummaryService, isLedgerEligible, isRemoved, REMOVED_REASON, tradeRef } from './client-summary.service';
import { NOT_SENT } from './copy-engine.service';
import { PositionResizeService } from './position-resize.service';
import { MarketFeedService } from '../market-data/market-feed.service';
import { PriceCacheService } from '../market-data/price-cache.service';
import { startOfTradingDayIST } from '../admin/admin.service';
import { overlayLivePrices, paperPositionView } from './price-overlay';
import { SignalService } from './signal.service';
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
    private readonly resizer: PositionResizeService,
    private readonly signals: SignalService,
  ) {}

  /**
   * Client dashboard: software trading mode, today's performance from the internal trade ledger (software-level
   * P&L, per strategy) kept separate from actual broker-executed (Demat) P&L, a display-only broker status,
   * subscriptions and licence. Nothing here connects to or authenticates with a broker.
   */
  @Get('dashboard')
  async dashboard(@CurrentUser() user: RequestUser) {
    const [me, accounts, day] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: { licenceExpiresAt: true, licenceDays: true, licenceAssignedAt: true, demo: true, tradingMode: true } }),
      this.prisma.brokerAccount.findMany({ where: { userId: user.id, broker: { not: 'MOCK' }, mode: 'TRADING' }, orderBy: { updatedAt: 'desc' } }),
      this.summary.today(user.id),
    ]);
    const subs = day.strategies;
    const now = Date.now();
    const exp = me?.licenceExpiresAt?.getTime() ?? null;
    const primary = accounts.find((a) => a.status === 'CONNECTED') ?? accounts[0] ?? null;
    const tradingMode: 'PAPER' | 'LIVE' = me && !me.demo && me.tradingMode === 'LIVE' ? 'LIVE' : 'PAPER';
    return {
      /** Software trading mode (dashboard switch) — independent of the broker connection. */
      tradingMode,
      /** Software-level P&L (internal trade ledger). */
      todayPnl: day.todayPnl,
      software: day.software,
      /** Actual broker-executed (Demat) P&L — real fills only. */
      brokerPnl: day.brokerPnl,
      /** Display-only broker status. Connect / reconnect happens in the Broker connection section only. */
      broker: primary
        ? {
            accountId: primary.id,
            broker: primary.broker,
            brokerClientId: primary.brokerClientId,
            status: primary.status,
            connected: primary.status === 'CONNECTED' && (!primary.tokenExpiresAt || primary.tokenExpiresAt.getTime() > now),
            tradingMode,
            /** Kept for older web builds: the client can always switch now. */
            paperForced: false,
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
        demo: me?.demo ?? false,
      },
      strategies: subs,
    };
  }

  /**
   * Software Paper / Live switch (dashboard). It only changes the software's trading mode:
   *  - never connects, disconnects or authenticates a broker, and needs no broker connection;
   *  - PAPER = strategy trades are simulated in the software; LIVE = strategy trades are recorded in the software
   *    and, when a valid broker connection exists, sent to the broker as real orders;
   *  - places no broker order. PAPER → LIVE closes open PAPER trades in the software (simulated, at LTP), so a later
   *    strategy exit is never sent to the broker for a position that only existed on paper.
   * Re-sending the current mode is a no-op.
   */
  @HttpCode(HttpStatus.OK)
  @Post('trading-mode')
  async tradingMode(@CurrentUser() user: RequestUser, @Body() dto: TradingModeDto, @Req() req: Request) {
    const me = await this.prisma.user.findUnique({ where: { id: user.id }, select: { demo: true, tradingMode: true } });
    if (!me) throw new NotFoundException('User not found');
    if (dto.mode === 'LIVE' && me.demo) throw new ForbiddenException('Demo licence: only paper trading is allowed. Ask your master for a full licence to trade live.');
    if (me.tradingMode === dto.mode) return { mode: dto.mode, paperClosed: 0, unchanged: true };
    const accounts = await this.prisma.brokerAccount.findMany({ where: { userId: user.id, mode: 'TRADING' } });
    let paperClosed = 0;
    if (dto.mode === 'LIVE') {
      for (const a of accounts) {
        if (!this.trading.isSimulated(a)) continue; // only paper books — squareOffAccount places no broker order for them
        const r = await this.risk.squareOffAccount(a, { intradayOnly: false }).catch((e: Error) => {
          throw new BadRequestException(`Could not close your open paper trades (${e.message}) — try again.`);
        });
        paperClosed += r.orders;
      }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { tradingMode: dto.mode } });
    // Real broker accounts follow the switch (isPaper) so every exit path treats them the same way. The paper
    // ledger account (MOCK) is always paper. Broker status / tokens are not touched.
    const real = accounts.filter((a) => a.broker !== 'MOCK');
    if (real.length) await this.prisma.brokerAccount.updateMany({ where: { id: { in: real.map((a) => a.id) } }, data: { isPaper: dto.mode === 'PAPER' } });
    const ledger = await this.trading.ensureLedgerAccount(user.id);
    await this.audit.log({ action: 'PROFILE_UPDATED', actorUserId: user.id, targetType: 'User', targetId: user.id, metadata: { tradingMode: dto.mode, paperClosed }, client: clientInfo(req) });
    for (const a of [...real, ledger]) this.accountEvents.emit({ type: 'settings', brokerAccountId: a.id, userId: user.id });
    return { mode: dto.mode, paperClosed };
  }

  /** Marketplace: last 7 days of trades of one live strategy (lot size / quantity shown as the master traded). */
  @Get('strategies/:id/history')
  async strategyHistory(@Param('id') id: string) {
    const st = await this.prisma.strategy.findUnique({ where: { id }, select: { status: true } });
    if (!st || (st.status !== 'ACTIVE' && st.status !== 'PAUSED')) throw new NotFoundException('Strategy not found');
    const rows = await this.signals.list(null, { status: 'all', from: new Date(Date.now() - 7 * 86_400_000), strategyIds: [id] });
    return rows.map(({ copyStatusCounts: _c, masterName: _m, ...r }) => r);
  }

  /** Activity log: every change on my account, who made it (me / admin / master / system), and my logins. */
  @Get('activity')
  async activity(@CurrentUser() user: RequestUser, @Query('page') pageQ?: string) {
    const page = Math.max(1, Number(pageQ) || 1);
    const pageSize = 50;
    const [subs, accounts, apiCfgs] = await Promise.all([
      this.prisma.strategyFollower.findMany({ where: { followerUserId: user.id }, select: { id: true, strategy: { select: { name: true } } } }),
      this.prisma.brokerAccount.findMany({ where: { userId: user.id }, select: { id: true, broker: true } }),
      this.prisma.brokerApiConfig.findMany({ where: { userId: user.id }, select: { id: true, broker: true } }),
    ]);
    const where = {
      createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
      action: { notIn: ['COPY_ORDER_CREATED', 'COPY_ORDER_SUBMITTED', 'COPY_ORDER_FILLED', 'MASTER_TRADE_DETECTED'] as never[] },
      OR: [
        { actorUserId: user.id },
        { targetType: 'User', targetId: user.id },
        ...(subs.length ? [{ targetType: 'StrategyFollower', targetId: { in: subs.map((x) => x.id) } }] : []),
        ...(accounts.length ? [{ targetType: 'BrokerAccount', targetId: { in: accounts.map((x) => x.id) } }] : []),
        ...(apiCfgs.length ? [{ targetType: 'BrokerApiConfig', targetId: { in: apiCfgs.map((x) => x.id) } }] : []),
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const subName = new Map(subs.map((x) => [x.id, x.strategy.name]));
    const accName = new Map([...accounts.map((x) => [x.id, x.broker] as const), ...apiCfgs.map((x) => [x.id, x.broker] as const)]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => {
        return {
          id: r.id,
          at: r.createdAt.toISOString(),
          action: r.action,
          on: r.targetType === 'StrategyFollower' ? (subName.get(r.targetId ?? '') ?? 'Strategy') : r.targetType === 'BrokerAccount' || r.targetType === 'BrokerApiConfig' ? (accName.get(r.targetId ?? '') ?? 'Broker') : null,
          metadata: (r.metadata ?? null) as Record<string, unknown> | null,
          ip: r.ip,
          userAgent: r.userAgent,
        };
      }),
    };
  }

  /** Marketplace: every live strategy, with my connection (if any). */
  @Get('marketplace')
  async marketplace(@CurrentUser() user: RequestUser) {
    const [rows, mine] = await Promise.all([
      this.prisma.strategy.findMany({
        where: { status: { in: ['ACTIVE', 'PAUSED', 'DRAFT'] } },
        include: { master: { select: { name: true } }, _count: { select: { followers: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.strategyFollower.findMany({ where: { followerUserId: user.id } }),
    ]);
    const byStrategy = new Map(mine.filter((m) => !isRemoved(m)).map((m) => [m.strategyId, m]));
    // Only strategies given to me by the master / admin are listed (plus ones I disconnected myself, to reconnect).
    const allowed = new Set(mine.filter((m) => !isRemoved(m) || m.stoppedByUserId === user.id).map((m) => m.strategyId));
    return rows.filter((st) => allowed.has(st.id)).map((st) => {
      const sub = byStrategy.get(st.id);
      return { ...toStrategyView(st), connected: !!sub, subscription: sub ? toStrategyFollowerView(sub) : null, allocationLabel: sub ? allocationLabel(sub) : null };
    });
  }

  /**
   * Disconnect a strategy: copying stops and the strategy with its trades disappears from my screens.
   * Positions already in my broker account are NOT closed (exit them first if needed).
   */
  @HttpCode(HttpStatus.OK)
  @Post('strategies/:id/disconnect')
  async disconnect(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    const sub = await this.prisma.strategyFollower.findUnique({ where: { strategyId_followerUserId: { strategyId: id, followerUserId: user.id } } });
    if (!sub || isRemoved(sub)) throw new NotFoundException('You are not connected to this strategy');
    await this.prisma.strategyFollower.update({
      where: { id: sub.id },
      data: { copyStatus: 'OFF', stoppedAt: new Date(), stoppedReason: REMOVED_REASON, stoppedByUserId: user.id },
    });
    await this.audit.log({ action: 'COPY_STOPPED', actorUserId: user.id, targetType: 'StrategyFollower', targetId: sub.id, metadata: { disconnected: true }, client: clientInfo(req) });
    this.accountEvents.emit({ type: 'settings', brokerAccountId: sub.brokerAccountId ?? '', userId: user.id });
    return { disconnected: true };
  }

  /** My connected strategies (connected by me from the marketplace, or by admin / master). */
  @Get('strategies')
  async strategies(@CurrentUser() user: RequestUser) {
    const mine = (await this.prisma.strategyFollower.findMany({ where: { followerUserId: user.id } })).filter((m) => !isRemoved(m));
    if (!mine.length) return [];
    const rows = await this.prisma.strategy.findMany({
      where: { id: { in: mine.map((m) => m.strategyId) }, status: { in: ['ACTIVE', 'PAUSED', 'DRAFT'] } },
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
    // A broker account is optional: without one, trades are recorded on the internal paper ledger account
    // (paper trading, or LIVE trades that are not sent until a broker is connected).
    const account = dto.brokerAccountId
      ? await this.prisma.brokerAccount.findFirst({ where: { id: dto.brokerAccountId, userId: user.id } })
      : await this.prisma.brokerAccount
          .findMany({ where: { userId: user.id, mode: 'TRADING', broker: { not: 'MOCK' } }, orderBy: { createdAt: 'asc' } })
          .then(async (list) => list.find((a) => a.status === 'CONNECTED') ?? list[0] ?? (await this.trading.ensureLedgerAccount(user.id)));
    if (!account) throw new BadRequestException('Choose one of your broker accounts');
    if (account.mode === 'DATA_ONLY') throw new BadRequestException('This account is a data-only (master) account and cannot receive orders.');
    if (dto.allocationMode === 'FIXED_QUANTITY' && !dto.fixedQuantity && !dto.fixedLots) throw new BadRequestException('Fixed quantity or fixed lots is required');
    if (dto.allocationMode === 'CAPITAL_PERCENTAGE' && !dto.allocationPercent) throw new BadRequestException('Allocation % is required');
    if (dto.allocationMode === 'PROPORTIONAL' && !dto.allocationAmount) throw new BadRequestException('Capital amount is required');
    const existing = await this.prisma.strategyFollower.findUnique({ where: { strategyId_followerUserId: { strategyId: id, followerUserId: user.id } } });
    if (!existing || (isRemoved(existing) && existing.stoppedByUserId !== user.id)) {
      throw new ForbiddenException('This strategy is not assigned to you — ask your master to assign it.');
    }
    // Connecting from the marketplace: a new (or previously disconnected) subscription takes a free seat.
    if ((!existing || isRemoved(existing)) && s.maxFollowers) {
      const taken = await this.prisma.strategyFollower.count({ where: { strategyId: id, NOT: { copyStatus: 'OFF', stoppedReason: REMOVED_REASON } } });
      if (taken >= s.maxFollowers) throw new BadRequestException('This strategy is full');
    }
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
      // Re-connecting a disconnected strategy makes it visible again.
      ...(existing && isRemoved(existing) ? { stoppedReason: null } : {}),
    };
    const row = await this.prisma.strategyFollower.upsert({
      where: { strategyId_followerUserId: { strategyId: id, followerUserId: user.id } },
      create: { strategyId: id, followerUserId: user.id, ...data },
      update: data,
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({ action: 'PROFILE_UPDATED', actorUserId: user.id, targetType: 'StrategyFollower', targetId: row.id, metadata: { strategyId: id, ...dto }, client: clientInfo(req) });
    this.accountEvents.emit({ type: 'settings', brokerAccountId: account.id, userId: user.id });
    // New lot multiplier also applies to trades already booked (still open) in this strategy.
    let resized: Awaited<ReturnType<PositionResizeService['resizeOpen']>> = [];
    // Test mode: a lot change only RE-STATES trades on the website (trade book / P&L) — no orders are placed.
    if (dto.applyToOpenTrades === true && process.env.ALLOW_LIVE_RESIZE === 'true') {
      try {
        resized = await this.resizer.resizeOpen(row.id, user.id);
      } catch (err) {
        resized = [{ symbol: '—', from: 0, to: 0, side: 'BUY', quantity: 0, ok: false, error: (err as Error).message }];
      }
    }
    return { ...toStrategyFollowerView(row), resized };
  }

  @HttpCode(HttpStatus.OK)
  @Post('subscriptions/:id/:action')
  async toggle(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('action') action: string, @Req() req: Request) {
    if (action !== 'start' && action !== 'stop') throw new NotFoundException();
    const sub = await this.prisma.strategyFollower.findFirst({ where: { id, followerUserId: user.id }, include: { brokerAccount: true } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (action === 'start' && isRemoved(sub)) throw new BadRequestException('This strategy is no longer assigned to you.');
    // Activating a strategy needs NO broker connection: paper trades are simulated, and in LIVE mode strategy
    // trades are recorded in the software (sent to the broker only once a valid connection exists).
    let accountId = sub.brokerAccountId;
    if (action === 'start') {
      const a = sub.brokerAccount;
      if (a?.mode === 'DATA_ONLY') throw new BadRequestException('A data-only (master) account cannot be used for copy trading.');
      if (!a) accountId = (await this.trading.ensureLedgerAccount(user.id)).id;
    }
    const row = await this.prisma.strategyFollower.update({
      where: { id },
      data:
        action === 'start'
          ? { copyStatus: 'ON', startedAt: new Date(), stoppedAt: null, stoppedReason: null, brokerAccountId: accountId }
          : { copyStatus: 'OFF', stoppedAt: new Date(), stoppedReason: 'Stopped by client', stoppedByUserId: user.id },
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({ action: action === 'start' ? 'COPY_STARTED' : 'COPY_STOPPED', actorUserId: user.id, targetType: 'StrategyFollower', targetId: id, client: clientInfo(req) });
    this.accountEvents.emit({ type: 'settings', brokerAccountId: accountId ?? '', userId: user.id });
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

  /** Clients may not exit single positions — exits come from the master (or "Exit all & stop copy"). */
  @HttpCode(HttpStatus.FORBIDDEN)
  @Post('positions/exit')
  exitPosition() {
    throw new ForbiddenException('Position exit is managed by your master trader.');
  }

  // ------------------------------------------------------------- portfolio

  /**
   * Portfolio / Positions: today's software-generated strategy trades from the internal trade ledger, in the same
   * format for Paper and Live and whatever the broker did with the order (status = Open / Closed). Software-level
   * P&L and actual broker-executed (Demat) P&L are returned separately and never combined.
   */
  @Get('trades')
  async tradeBook(@CurrentUser() user: RequestUser) {
    const [led, broker] = await Promise.all([this.summary.ledger(user.id), this.summary.tradeBook(user.id, { brokerOnly: true })]);
    return {
      software: led.summary,
      /** Kept for older web builds = software-level total. */
      totalPnl: led.summary.totalPnl,
      brokerExecuted: { totalPnl: broker.totalPnl, trades: broker.rows.length },
      rows: led.trades,
    };
  }

  /**
   * Orders section — the single place that shows ACTUAL broker execution: every order the software created for a
   * strategy trade today, linked by Strategy Trade ID, with broker order id, status (Pending / Submitted / Open /
   * Executed / Partially filled / Rejected / Cancelled / Failed / Not sent), rejection reason, filled qty and price.
   * Status here comes only from broker responses / order-status reconciliation.
   */
  @Get('orders')
  async orders(@CurrentUser() user: RequestUser) {
    const since = startOfTradingDayIST();
    const [rows, led] = await Promise.all([
      this.prisma.copyOrder.findMany({
        where: { followerUserId: user.id, createdAt: { gte: since }, NOT: { strategyFollower: { copyStatus: 'OFF', stoppedReason: REMOVED_REASON } } },
        include: { strategyFollower: { select: { strategy: { select: { name: true } } } }, brokerAccount: { select: { broker: true, brokerClientId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.summary.ledger(user.id),
    ]);
    return rows.map((c) => orderView(c, c.strategyFollower.strategy.name, isLedgerEligible(c) ? c.id : (led.exitLinks.get(c.id) ?? null)));
  }

  /**
   * My positions, holdings and orders. Platform history (copied trades, closed paper positions) is shown for
   * TODAY only (IST trading day) — it starts empty every morning. Holdings come straight from the broker.
   */
  @Get('portfolio')
  async portfolio(@CurrentUser() user: RequestUser) {
    const since = startOfTradingDayIST();
    const [live, paper, copyOrders, day, mode, led] = await Promise.all([
      this.trading.liveData(user.id),
      this.prisma.position.findMany({
        where: { userId: user.id, isPaper: true, OR: [{ quantity: { not: 0 } }, { updatedAt: { gte: since } }] },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.copyOrder.findMany({
        where: { followerUserId: user.id, createdAt: { gte: since }, NOT: { strategyFollower: { copyStatus: 'OFF', stoppedReason: REMOVED_REASON } } },
        include: { strategyFollower: { select: { strategy: { select: { name: true } } } }, brokerAccount: { select: { broker: true, brokerClientId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.summary.today(user.id),
      this.trading.tradingModeOf(user.id),
      this.summary.ledger(user.id),
    ]);
    return {
      /** true = software trading mode is Paper (dashboard switch). */
      paperMode: mode === 'PAPER',
      tradingMode: mode,
      /** Software-level P&L (internal ledger) and actual broker-executed P&L, kept separate. */
      todayPnl: day.todayPnl,
      brokerPnl: day.brokerPnl,
      live: overlayLivePrices(live, this.prices, this.feed),
      paperPositions: paper.map((p) => paperPositionView(p, this.prices, this.feed)),
      copyOrders: copyOrders.map((c) => orderView(c, c.strategyFollower.strategy.name, isLedgerEligible(c) ? c.id : (led.exitLinks.get(c.id) ?? null))),
    };
  }
}

/** Broker-execution label of an order (Orders section). Never "executed" without a broker fill. */
function brokerStatusOf(c: { isPaper: boolean; status: string; errorCode: string | null; filledQuantity: number; quantity: number }): string {
  if (c.isPaper) return 'PAPER';
  if (c.errorCode === NOT_SENT || c.errorCode === 'MISSED') return 'NOT_SENT';
  if (c.errorCode === 'SKIPPED') return 'SKIPPED';
  if (c.status === 'FILLED' && c.filledQuantity > 0) return 'EXECUTED';
  if (c.status === 'FILLED') return 'SUBMITTED'; // filled flag without a filled quantity is not trusted as an execution
  if (c.filledQuantity > 0 && c.filledQuantity < c.quantity) return 'PARTIALLY_FILLED';
  return c.status;
}

function orderView(
  c: CopyOrder & { brokerAccount?: { broker: string; brokerClientId: string | null } | null },
  strategyName: string,
  strategyTradeId: string | null,
) {
  return {
    ...toCopyOrderView(c),
    strategyName,
    strategyTradeId,
    strategyTradeRef: strategyTradeId ? tradeRef(strategyTradeId) : null,
    mode: c.isPaper ? ('PAPER' as const) : ('LIVE' as const),
    isExit: c.isExit,
    price: c.price == null ? null : c.price.toString(),
    triggerPrice: c.triggerPrice == null ? null : c.triggerPrice.toString(),
    brokerStatus: brokerStatusOf(c),
    brokerName: c.brokerAccount?.broker ?? c.broker,
    submittedAt: c.submittedAt?.toISOString() ?? null,
    filledAt: c.filledAt?.toISOString() ?? null,
  };
}
