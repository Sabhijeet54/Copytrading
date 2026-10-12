import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { Prisma } from '@ctp/database';
import type { BrokerAccount, CopyOrder, MasterTrade, PrismaClient, StrategyFollower, Strategy } from '@ctp/database';
import { RedisKeys } from '@ctp/types';
import { AuditService } from '../audit/audit.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { REDIS } from '../common/redis/redis.module';
import type { BrokerOrder, PlaceOrderInput } from './broker-adapter';
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

const F = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));

/**
 * Turns one master trade into one copy order per active follower.
 *  - Idempotent: MasterTrade(brokerAccountId, brokerOrderId) and CopyOrder(masterTradeId, followerUserId) are unique.
 *  - Honors the admin kill switch, PAPER_MODE, follower limits and strategy limits.
 *  - Simulated (paper) orders fill immediately at the master's price and update the Position table.
 */
@Injectable()
export class CopyEngineService {
  private readonly logger = new Logger('CopyEngine');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly trading: TradingService,
    private readonly audit: AuditService,
  ) {}

  async isHalted(): Promise<boolean> {
    return Boolean(await this.redis.get(RedisKeys.copyHalted));
  }

  /** Records the master trade (once) and fans it out. Returns null if it was already recorded. */
  async onMasterTrade(strategy: Strategy, masterAccount: BrokerAccount, t: MasterTradeInput): Promise<MasterTrade | null> {
    let trade: MasterTrade;
    try {
      trade = await this.prisma.masterTrade.create({
        data: {
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
          rawPayload: (t.raw ?? { lotSize: t.lotSize ?? 1 }) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
    await this.audit.log({
      action: 'MASTER_TRADE_DETECTED',
      actorUserId: strategy.masterUserId,
      targetType: 'MasterTrade',
      targetId: trade.id,
      metadata: { strategyId: strategy.id, symbol: t.symbol, side: t.side, quantity: t.quantity },
    });
    await this.fanOut(strategy, trade, t.lotSize ?? 1);
    return trade;
  }

  private followerQuantity(strategy: Strategy, f: StrategyFollower, masterQty: number, price: number | null, lotSize: number): { qty: number; reason?: string } {
    let qty: number;
    if (f.allocationMode === 'FIXED_QUANTITY') {
      qty = f.fixedQuantity ?? 0;
    } else if (f.allocationMode === 'CAPITAL_PERCENTAGE') {
      qty = Math.floor((masterQty * (F(f.allocationPercent) ?? 0)) / 100);
    } else {
      const masterCap = F(strategy.masterCapital) ?? 0;
      const followerCap = F(f.allocationAmount) ?? 0;
      if (masterCap <= 0) return { qty: 0, reason: 'Strategy has no master capital set for proportional allocation' };
      qty = Math.floor((masterQty * followerCap) / masterCap);
    }
    const lot = Math.max(1, lotSize);
    qty = Math.floor(qty / lot) * lot;
    const caps = [f.maxQuantity, strategy.maxQuantityPerOrder].filter((c): c is number => typeof c === 'number' && c > 0);
    for (const c of caps) qty = Math.min(qty, Math.floor(c / lot) * lot);
    if (price && price > 0) {
      const valueCaps = [F(f.maxTradeValue), F(strategy.maxOrderValue)].filter((c): c is number => c != null && c > 0);
      for (const c of valueCaps) qty = Math.min(qty, Math.floor(c / price / lot) * lot);
    }
    if (qty <= 0) return { qty: 0, reason: 'Calculated quantity is 0 (allocation or limits too small)' };
    return { qty };
  }

  private async fanOut(strategy: Strategy, trade: MasterTrade, lotSize: number): Promise<void> {
    if (await this.isHalted()) {
      this.logger.warn(`Copy trading halted — master trade ${trade.id} not copied.`);
      return;
    }
    const followers = await this.prisma.strategyFollower.findMany({
      where: { strategyId: strategy.id, copyStatus: 'ON', brokerAccountId: { not: null } },
      include: { brokerAccount: true },
    });
    const price = F(trade.averagePrice) ?? F(trade.price);
    await Promise.allSettled(followers.map((f) => this.copyToFollower(strategy, trade, f, f.brokerAccount!, price, lotSize)));
  }

  private async copyToFollower(
    strategy: Strategy,
    trade: MasterTrade,
    f: StrategyFollower,
    account: BrokerAccount,
    price: number | null,
    lotSize: number,
  ): Promise<void> {
    const masterQty = trade.filledQuantity > 0 ? trade.filledQuantity : trade.quantity;
    const { qty, reason } = this.followerQuantity(strategy, f, masterQty, price, lotSize);
    const simulated = this.trading.isSimulated(account);
    let order: CopyOrder;
    try {
      order = await this.prisma.copyOrder.create({
        data: {
          masterTradeId: trade.id,
          strategyFollowerId: f.id,
          followerUserId: f.followerUserId,
          brokerAccountId: account.id,
          broker: account.broker,
          idempotencyKey: `${trade.id}:${f.followerUserId}`,
          exchange: trade.exchange,
          symbol: trade.symbol,
          instrumentToken: trade.instrumentToken,
          side: trade.side,
          orderType: trade.orderType === 'MARKET' ? 'MARKET' : trade.orderType,
          productType: trade.productType,
          quantity: qty,
          price: trade.price ?? undefined,
          status: qty > 0 ? 'PENDING' : 'REJECTED',
          errorCode: qty > 0 ? null : 'SKIPPED',
          errorMessage: reason ?? null,
          isPaper: simulated,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
    if (qty <= 0) return;
    await this.audit.log({ action: 'COPY_ORDER_CREATED', actorUserId: null, targetType: 'CopyOrder', targetId: order.id, metadata: { followerUserId: f.followerUserId, qty } });

    if (simulated) {
      const fillPrice = price ?? 0;
      await this.prisma.copyOrder.update({
        where: { id: order.id },
        data: { status: 'FILLED', filledQuantity: qty, averagePrice: fillPrice, submittedAt: new Date(), filledAt: new Date(), attempts: 1, lastAttemptAt: new Date() },
      });
      await this.applyPaperFill(f.followerUserId, account.id, trade, qty, fillPrice);
      await this.audit.log({ action: 'COPY_ORDER_FILLED', targetType: 'CopyOrder', targetId: order.id, metadata: { paper: true, qty, price: fillPrice } });
      return;
    }

    try {
      const adapter = await this.trading.adapterFor(account);
      const { brokerOrderId } = await adapter.placeOrder({
        exchange: trade.exchange,
        symbol: trade.symbol,
        side: trade.side,
        quantity: qty,
        orderType: trade.orderType,
        productType: trade.productType,
        price: F(trade.price),
        tag: 'ctpcopy',
      });
      await this.prisma.copyOrder.update({
        where: { id: order.id },
        data: { status: 'SUBMITTED', brokerOrderId, submittedAt: new Date(), attempts: 1, lastAttemptAt: new Date() },
      });
      await this.audit.log({ action: 'COPY_ORDER_SUBMITTED', targetType: 'CopyOrder', targetId: order.id, metadata: { brokerOrderId } });
    } catch (err) {
      const msg = await this.trading.handleBrokerError(account, err);
      await this.prisma.copyOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED', errorCode: 'BROKER_ERROR', errorMessage: msg.slice(0, 500), attempts: 1, lastAttemptAt: new Date() },
      });
      await this.audit.log({ action: 'COPY_ORDER_FAILED', targetType: 'CopyOrder', targetId: order.id, metadata: { error: msg } });
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
      let q1 = q0 + signed;
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
      q1 = q0 + signed;
      await tx.position.update({
        where: { id: cur.id },
        data: { quantity: q1, averagePrice: avg, lastPrice: price, realizedPnl: realized, unrealizedPnl: q1 * (price - avg) },
      });
    });
  }
}
