import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type Redis from 'ioredis';
import { Prisma } from '@ctp/database';
import type { BrokerAccount, BrokerName, MasterTrade, OrderStatus, PrismaClient, Strategy, StrategyFollower } from '@ctp/database';
import { redact } from '@ctp/shared';
import { RedisKeys, WsEvent } from '@ctp/types';
import { AuditService } from '../audit/audit.service';
import { isRetryable } from '../brokers/broker-http';
import { Throttle } from '../brokers/throttle';
import { PRISMA } from '../common/prisma/prisma.service';
import { REDIS } from '../common/redis/redis.module';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { InstrumentsService } from '../market-data/instruments.service';
import { MarketFeedService } from '../market-data/market-feed.service';
import { instrumentKey, PriceCacheService } from '../market-data/price-cache.service';
import { NotifyService } from '../realtime/notify.service';
import { RealtimeService } from '../realtime/realtime.gateway';
import { OrderBlockedError, segmentOf, type BrokerOrder, type PlaceOrderInput } from './broker-adapter';
import { ClientRegistryService, type ClientEntry } from './client-registry.service';
import { computeCopyQuantity } from './copy-quantity';
import { TradingService } from './trading.service';

export interface MasterTradeInput extends PlaceOrderInput {
  brokerOrderId: string;
  filledQuantity: number;
  averagePrice: number | null;
  status: BrokerOrder['status'];
  instrumentToken?: string;
  lotSize?: number;
  timestamp: Date;
  raw?: unknown;
}

/** Outcome of one follower's copy of one master trade. */
export interface CopyResult {
  followerId: string;
  userId: string;
  accountId: string | null;
  broker: BrokerName | null;
  simulated: boolean;
  qty: number;
  status: OrderStatus;
  brokerOrderId?: string;
  fillPrice?: number;
  errorCode?: string;
  errorMessage?: string;
  latencyMs?: number;
  attempts: number;
  /** Signal not executed because the follower's broker was not connected (history only). */
  missed?: boolean;
}

export interface FanOutSummary {
  tradeId: string;
  results: CopyResult[];
  /** Master detection → last broker ack (ms). */
  totalMs: number;
}

/** Rolling latency statistics (in memory). */
export class LatencyStats {
  private readonly ring: number[] = [];
  private day = '';
  private count = 0;
  private sum = 0;
  push(ms: number): void {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
      this.sum = 0;
    }
    this.count++;
    this.sum += ms;
    this.ring.push(ms);
    if (this.ring.length > 1000) this.ring.shift();
  }
  snapshot(): { todayCount: number; todayAvgMs: number | null; p50Ms: number | null; p95Ms: number | null; lastMs: number | null } {
    const sorted = [...this.ring].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]! : null);
    return {
      todayCount: this.count,
      todayAvgMs: this.count ? Math.round(this.sum / this.count) : null,
      p50Ms: pct(0.5),
      p95Ms: pct(0.95),
      lastMs: this.ring.length ? this.ring[this.ring.length - 1]! : null,
    };
  }
}

const F = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
const OK_STATUSES: OrderStatus[] = ['SUBMITTED', 'FILLED'];

/**
 * Turns one master trade into one order per active follower — as fast as possible:
 *  - Hot path reads only memory (ClientRegistry: pre-built adapters with decrypted tokens, settings, risk state;
 *    PriceCache for LTP). No DB query and no quote call before orders go out.
 *  - All followers are sent IN PARALLEL (Promise.all), through a per-broker token-bucket throttle, on keep-alive
 *    connections. One retry only for errors where the order surely did not reach the broker (or HTTP 429/503).
 *  - Master exits are mirrored: when the master closes a position, followers close their copy position.
 *  - Idempotent: Redis SET NX on (master account, broker order id) before fan-out + DB unique constraints.
 *  - Persistence (MasterTrade, CopyOrders, audit, notifications) happens AFTER the orders are sent.
 */
@Injectable()
export class CopyEngineService {
  private readonly logger = new Logger('CopyEngine');
  private readonly throttles = new Map<string, Throttle>();
  readonly latency = new LatencyStats();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly trading: TradingService,
    private readonly audit: AuditService,
    @Optional() private readonly registry?: ClientRegistryService,
    @Optional() private readonly prices?: PriceCacheService,
    @Optional() private readonly instruments?: InstrumentsService,
    @Optional() private readonly feed?: MarketFeedService,
    @Optional() private readonly realtime?: RealtimeService,
    @Optional() private readonly notifier?: NotifyService,
    @Optional() @Inject(API_CONFIG) private readonly config?: ApiConfig,
  ) {}

  async isHalted(): Promise<boolean> {
    return Boolean(await this.redis.get(RedisKeys.copyHalted));
  }

  /** Kept for backwards compatibility / unit tests. */
  followerQuantity(strategy: Strategy, f: StrategyFollower, masterQty: number, price: number | null, lotSize: number) {
    return computeCopyQuantity(strategy, f, masterQty, price, lotSize);
  }

  private throttle(broker: string): Throttle {
    let t = this.throttles.get(broker);
    if (!t) {
      const rate = broker === 'ANGEL_ONE' ? (this.config?.ORDER_RATE_PER_SEC_ANGEL ?? 10) : (this.config?.ORDER_RATE_PER_SEC_ZERODHA ?? 10);
      t = new Throttle(rate);
      this.throttles.set(broker, t);
    }
    return t;
  }

  /**
   * Records the master trade (once) and fans it out. Returns null if this master order was already processed.
   * `strategy` only needs id + masterUserId; `masterAccount` only id + broker.
   */
  async onMasterTrade(
    strategy: Pick<Strategy, 'id' | 'masterUserId'>,
    masterAccount: Pick<BrokerAccount, 'id' | 'broker'>,
    t: MasterTradeInput,
  ): Promise<FanOutSummary | null> {
    const t0 = performance.now();
    const registry = this.registry!;

    // One Redis round trip: idempotency + kill switch.
    const res = await this.redis
      .multi()
      .set(`ctp:mt:${masterAccount.id}:${t.brokerOrderId}`, '1', 'EX', 3 * 86400, 'NX')
      .get(RedisKeys.copyHalted)
      .exec();
    if (res?.[0]?.[1] !== 'OK') return null;
    const halted = Boolean(res?.[1]?.[1]);

    const tradeId = randomUUID();
    const key = instrumentKey(t.exchange, t.symbol);
    const lotSize = this.instruments?.lotSize(t.exchange, t.symbol) ?? t.lotSize ?? 1;
    const masterQty = t.filledQuantity > 0 ? t.filledQuantity : t.quantity;
    const signed = t.side === 'BUY' ? masterQty : -masterQty;
    const before = registry.masterNetOf(strategy.id, t.exchange, t.symbol, t.productType);
    registry.applyMasterFill(strategy.id, t.exchange, t.symbol, t.productType, signed);
    const after = before + signed;
    const closing = before !== 0 && Math.sign(signed) !== Math.sign(before);
    const fullExit = closing && (after === 0 || Math.sign(after) !== Math.sign(before));
    const price = t.averagePrice ?? t.price ?? this.prices?.get(key) ?? null;
    this.feed?.ensure(t.exchange, t.symbol);

    let results: CopyResult[] = [];
    if (halted) {
      this.logger.warn(`Kill switch active — master trade ${t.brokerOrderId} not copied.`);
    } else {
      const ctx = { strategyId: strategy.id, t, signed, closing, fullExit, price, lotSize, masterQty, t0 };
      results = await Promise.all(registry.forStrategy(strategy.id).map((c) => this.copyOne(c, ctx)));
    }
    const totalMs = Math.round(performance.now() - t0);
    // Followers with copy ON whose demat is not connected (disconnected / expired / no account): record the
    // signal in their history as a MISSED paper-style entry (would-be qty @ master price), and tell them.
    for (const s of registry.skipped(strategy.id)) {
      this.logger.warn(`Skipped follower ${s.followerId}: ${s.reason}`);
      const strat = registry.strategy(strategy.id) ?? { masterCapital: 0, maxOrderValue: null, maxQuantityPerOrder: null };
      const wouldBe = s.settings ? computeCopyQuantity(strat, s.settings, masterQty, price, lotSize).qty : 0;
      results.push({
        followerId: s.followerId,
        userId: s.userId,
        accountId: s.accountId,
        broker: s.broker,
        simulated: false,
        qty: wouldBe,
        fillPrice: price ?? undefined,
        status: 'REJECTED',
        errorCode: 'MISSED',
        errorMessage: `Signal aaya tha, par aapka demat connect nahi tha (${s.reason}).`,
        attempts: 0,
        missed: true,
      });
    }
    const sent = results.filter((r) => r.attempts > 0).length;
    if (sent) this.logger.log(`Master ${t.side} ${masterQty} ${key} → ${sent} follower order(s) in ${totalMs} ms`);

    await this.persist(tradeId, strategy, masterAccount, t, lotSize, results).catch((err) =>
      this.logger.error(`Persist of trade ${tradeId} failed: ${(err as Error).message}`),
    );
    return { tradeId, results, totalMs };
  }

  // ------------------------------------------------------------ hot path

  private async copyOne(
    c: ClientEntry,
    x: { strategyId: string; t: MasterTradeInput; signed: number; closing: boolean; fullExit: boolean; price: number | null; lotSize: number; masterQty: number; t0: number },
  ): Promise<CopyResult> {
    const base = { followerId: c.followerId, userId: c.userId, accountId: c.accountId, broker: c.broker, simulated: c.simulated };
    const skip = (reason: string): CopyResult => ({ ...base, qty: 0, status: 'REJECTED', errorCode: 'SKIPPED', errorMessage: reason, attempts: 0 });
    const registry = this.registry!;
    const { t } = x;
    const s = c.settings;

    if (!c.simulated && c.tokenExpiresAt && c.tokenExpiresAt <= Date.now()) return skip('Broker token expired');

    let qty: number;
    const net = registry.clientNet(c.followerId, t.exchange, t.symbol, t.productType);
    if (x.closing) {
      // Exit mirroring: close (part of) the follower's own copy position, never open a new one.
      if (net === 0 || Math.sign(net) === Math.sign(x.signed)) return skip('No open copy position to exit');
      if (x.fullExit) qty = Math.abs(net);
      else {
        const strat = registry.strategy(x.strategyId) ?? { masterCapital: 0, maxOrderValue: null, maxQuantityPerOrder: null };
        const calc = computeCopyQuantity(strat, { ...s, maxLots: null, maxQuantity: null, maxTradeValue: null }, x.masterQty, null, x.lotSize).qty;
        qty = Math.min(calc || Math.abs(net), Math.abs(net));
      }
    } else {
      if (s.allowedSegments.length && !s.allowedSegments.includes(segmentOf(t.exchange))) return skip(`Segment ${segmentOf(t.exchange)} not allowed`);
      const day = registry.day(c.followerId);
      if (day.breached || (s.maxDailyLoss && day.pnl !== null && day.pnl <= -s.maxDailyLoss)) return skip('Daily loss limit reached');
      if (s.maxTradesPerDay && day.trades >= s.maxTradesPerDay) return skip(`Max ${s.maxTradesPerDay} trades/day reached`);
      const strat = registry.strategy(x.strategyId) ?? { masterCapital: 0, maxOrderValue: null, maxQuantityPerOrder: null };
      const calc = computeCopyQuantity(strat, s, x.masterQty, x.price, x.lotSize);
      if (calc.qty <= 0) return skip(calc.reason ?? 'Quantity 0');
      qty = calc.qty;
    }
    registry.day(c.followerId).trades++;

    if (c.simulated) {
      const fillPrice = x.price ?? 0;
      registry.applyClientFill(c.followerId, t.exchange, t.symbol, t.productType, t.side === 'BUY' ? qty : -qty);
      const latencyMs = Math.round(performance.now() - x.t0);
      return { ...base, qty, status: 'FILLED', fillPrice, latencyMs, attempts: 1 };
    }

    const input: PlaceOrderInput = {
      exchange: t.exchange,
      symbol: t.symbol,
      side: t.side,
      quantity: qty,
      orderType: t.orderType,
      productType: t.productType,
      price: t.price ?? null,
      triggerPrice: t.triggerPrice ?? null,
      tag: 'ctpcopy',
    };
    let attempts = 0;
    for (;;) {
      attempts++;
      try {
        await this.throttle(c.broker).take();
        const { brokerOrderId } = await c.adapter!.placeOrder(input);
        const latencyMs = Math.round(performance.now() - x.t0);
        this.latency.push(latencyMs);
        registry.applyClientFill(c.followerId, t.exchange, t.symbol, t.productType, t.side === 'BUY' ? qty : -qty);
        return { ...base, qty, status: 'SUBMITTED', brokerOrderId, latencyMs, attempts };
      } catch (err) {
        if (attempts === 1 && isRetryable(err)) continue;
        const latencyMs = Math.round(performance.now() - x.t0);
        const blocked = err instanceof OrderBlockedError;
        if (!blocked && this.trading.isSessionError(err)) {
          registry.evictAccount(c.accountId, 'Broker session rejected');
          void this.trading.handleBrokerError({ id: c.accountId, userId: c.userId, broker: c.broker, brokerClientId: c.brokerClientId } as BrokerAccount, err);
        }
        const msg = err instanceof Error ? err.message : 'Broker error';
        return { ...base, qty, status: 'FAILED', errorCode: blocked ? 'ORDER_BLOCKED' : 'BROKER_ERROR', errorMessage: msg.slice(0, 500), latencyMs, attempts };
      }
    }
  }

  // ------------------------------------------------------------ after the orders are out

  private async persist(
    tradeId: string,
    strategy: Pick<Strategy, 'id' | 'masterUserId'>,
    masterAccount: Pick<BrokerAccount, 'id' | 'broker'>,
    t: MasterTradeInput,
    lotSize: number,
    results: CopyResult[],
  ): Promise<void> {
    try {
      await this.prisma.masterTrade.create({
        data: {
          id: tradeId,
          masterUserId: strategy.masterUserId,
          strategyId: strategy.id,
          brokerAccountId: masterAccount.id,
          broker: masterAccount.broker,
          brokerOrderId: t.brokerOrderId,
          exchange: t.exchange,
          symbol: t.symbol,
          instrumentToken: t.instrumentToken,
          side: t.side,
          orderType: t.orderType,
          productType: t.productType,
          quantity: t.quantity,
          filledQuantity: t.filledQuantity,
          price: t.price ?? undefined,
          averagePrice: t.averagePrice ?? undefined,
          status: t.status,
          eventTimestamp: t.timestamp,
          rawPayload: (t.raw ?? { lotSize }) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`Master order ${t.brokerOrderId} already recorded in DB`);
        return;
      }
      throw err;
    }

    const now = new Date();
    const rows = results.filter((r) => r.accountId);
    if (rows.length) {
      await this.prisma.copyOrder.createMany({
        skipDuplicates: true,
        data: rows.map((r) => ({
          masterTradeId: tradeId,
          strategyFollowerId: r.followerId,
          followerUserId: r.userId,
          brokerAccountId: r.accountId!,
          broker: r.broker ?? masterAccount.broker,
          idempotencyKey: `${tradeId}:${r.userId}`,
          exchange: t.exchange,
          symbol: t.symbol,
          instrumentToken: t.instrumentToken,
          side: t.side,
          orderType: t.orderType,
          productType: t.productType,
          quantity: r.qty,
          filledQuantity: r.status === 'FILLED' ? r.qty : 0,
          price: t.price ?? undefined,
          averagePrice: r.fillPrice ?? undefined, // for MISSED rows: master price (paper reference)
          status: r.status,
          brokerOrderId: r.brokerOrderId ?? null,
          errorCode: r.errorCode ?? null,
          errorMessage: r.errorMessage ?? null,
          attempts: r.attempts,
          latencyMs: r.latencyMs ?? null,
          lastAttemptAt: r.attempts ? now : null,
          submittedAt: OK_STATUSES.includes(r.status) ? now : null,
          filledAt: r.status === 'FILLED' ? now : null,
          isPaper: r.simulated,
        })),
      });
    }

    // Paper bookkeeping for simulated fills.
    await Promise.all(
      results
        .filter((r) => r.simulated && r.status === 'FILLED' && r.accountId)
        .map((r) => this.applyPaperFill(r.userId, r.accountId!, t, r.qty, r.fillPrice ?? 0).catch(() => undefined)),
    );

    await this.audit.log({
      action: 'MASTER_TRADE_DETECTED',
      actorUserId: strategy.masterUserId,
      targetType: 'MasterTrade',
      targetId: tradeId,
      metadata: { strategyId: strategy.id, symbol: t.symbol, side: t.side, quantity: t.quantity },
    });
    await this.prisma.auditLog
      .createMany({
        data: [
          ...rows
            .filter((r) => r.attempts > 0)
            .map((r) => ({
              action: (r.status === 'FILLED' ? 'COPY_ORDER_FILLED' : r.status === 'SUBMITTED' ? 'COPY_ORDER_SUBMITTED' : 'COPY_ORDER_FAILED') as 'COPY_ORDER_FILLED',
              targetType: 'CopyOrder',
              targetId: `${tradeId}:${r.userId}`,
              metadata: redact({ followerUserId: r.userId, qty: r.qty, paper: r.simulated, latencyMs: r.latencyMs, brokerOrderId: r.brokerOrderId, error: r.errorMessage }) as Prisma.InputJsonValue,
            })),
        ],
      })
      .catch((err) => this.logger.warn(`Audit write failed: ${(err as Error).message}`));

    // Realtime + notifications.
    const label = `${t.side} ${t.symbol}`;
    this.realtime?.toUser(strategy.masterUserId, WsEvent.MASTER_TRADE_DETECTED, {
      tradeId,
      symbol: t.symbol,
      side: t.side,
      sent: rows.filter((r) => r.attempts > 0).length,
      failed: rows.filter((r) => r.status === 'FAILED').length,
    });
    for (const r of rows) {
      if (r.missed) {
        this.realtime?.toUser(r.userId, WsEvent.COPY_ORDER_FAILED, { tradeId, symbol: t.symbol, side: t.side, qty: r.qty, status: 'MISSED', error: r.errorMessage });
        void this.notifier?.notify({
          userId: r.userId,
          type: 'SIGNAL_MISSED',
          severity: 'WARNING',
          title: `Signal missed: ${label}${r.qty ? ` × ${r.qty}` : ''}`,
          body: 'Aapka demat connect nahi tha — broker reconnect karein taaki agle signals copy hon.',
        });
        continue;
      }
      if (!r.attempts) continue;
      const event = r.status === 'FILLED' ? WsEvent.COPY_ORDER_FILLED : r.status === 'SUBMITTED' ? WsEvent.COPY_ORDER_SUBMITTED : WsEvent.COPY_ORDER_FAILED;
      this.realtime?.toUser(r.userId, event, { tradeId, symbol: t.symbol, side: t.side, qty: r.qty, status: r.status, error: r.errorMessage ?? null });
      if (r.status === 'FAILED') {
        void this.notifier?.notify({ userId: r.userId, type: 'COPY_ORDER_FAILED', severity: 'ERROR', title: `Order failed: ${label} × ${r.qty}`, body: r.errorMessage });
      } else {
        void this.notifier?.notify({
          userId: r.userId,
          type: r.status === 'FILLED' ? 'COPY_ORDER_FILLED' : 'COPY_ORDER_PLACED',
          severity: 'SUCCESS',
          title: `${r.simulated ? 'Paper fill' : 'Order placed'}: ${label} × ${r.qty}`,
          body: r.latencyMs != null ? `${r.latencyMs} ms` : undefined,
          telegram: true,
        });
      }
    }
  }

  /** Paper bookkeeping: net position, average price and realized P&L. */
  async applyPaperFill(userId: string, brokerAccountId: string, t: Pick<MasterTrade, 'exchange' | 'symbol' | 'productType' | 'side'>, qty: number, price: number): Promise<void> {
    const key = { brokerAccountId, exchange: t.exchange, symbol: t.symbol, productType: t.productType };
    const signed = t.side === 'BUY' ? qty : -qty;
    await this.prisma.$transaction(async (tx) => {
      const cur = await tx.position.findUnique({ where: { brokerAccountId_exchange_symbol_productType: key } });
      if (!cur) {
        await tx.position.create({ data: { ...key, userId, quantity: signed, averagePrice: price, lastPrice: price, isPaper: true } });
        return;
      }
      const q0 = cur.quantity;
      const a0 = Number(cur.averagePrice);
      const q1 = q0 + signed;
      let avg = a0;
      let realized = Number(cur.realizedPnl);
      if (q0 === 0 || Math.sign(q0) === Math.sign(signed)) {
        avg = (Math.abs(q0) * a0 + qty * price) / (Math.abs(q0) + qty);
      } else {
        const closed = Math.min(Math.abs(q0), qty);
        realized += closed * (price - a0) * Math.sign(q0);
        if (Math.sign(q1) !== Math.sign(q0) && q1 !== 0) avg = price;
        if (q1 === 0) avg = 0;
      }
      await tx.position.update({
        where: { id: cur.id },
        data: { quantity: q1, averagePrice: avg, lastPrice: price, realizedPnl: realized, unrealizedPnl: q1 * (price - avg) },
      });
    });
  }
}

export { F as toNumber };
