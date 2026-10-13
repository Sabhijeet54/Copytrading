import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import type { AllocationMode, BrokerAccount, BrokerName, Exchange, PrismaClient, ProductType } from '@ctp/database';
import { startOfTradingDayIST } from '../admin/admin.service';
import { warmConnection } from '../brokers/broker-http';
import { BrokerSessionService } from '../brokers/broker-session.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { AccountEvents } from '../realtime/account-events';
import { ADAPTERS } from './adapter-factory';
import type { BrokerAdapter } from './broker-adapter';
import type { QtySettings, QtyStrategy } from './copy-quantity';
import { TradingService } from './trading.service';

export interface ClientSettings extends QtySettings {
  allocationMode: AllocationMode;
  maxDailyLoss: number | null;
  maxTradesPerDay: number | null;
  allowedSegments: string[];
}

/** Everything needed to place one follower's copy order without touching the database. */
export interface ClientEntry {
  followerId: string;
  strategyId: string;
  userId: string;
  accountId: string;
  broker: BrokerName;
  brokerClientId: string | null;
  /** Paper: PAPER_MODE, isPaper or MOCK. */
  simulated: boolean;
  /** Pre-built adapter with the decrypted token (null for simulated accounts). */
  adapter: BrokerAdapter | null;
  /** epoch ms, null = no expiry known */
  tokenExpiresAt: number | null;
  settings: ClientSettings;
}

export interface SkippedClient {
  followerId: string;
  userId: string;
  accountId: string | null;
  broker: BrokerName | null;
  reason: string;
  /** Present when the follower's settings are known, so a "missed signal" can show the would-be quantity. */
  settings?: ClientSettings;
}

export interface StrategyInfo extends QtyStrategy {
  id: string;
  masterUserId: string;
  allowedExchanges: Exchange[];
  allowedInstruments: string[];
}

export interface DayState {
  day: string;
  trades: number;
  /** Latest day P&L of the follower account (from the risk poller), null = unknown. */
  pnl: number | null;
  breached: boolean;
}

const istDay = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const posKey = (owner: string, exchange: string, symbol: string, product: ProductType) => `${owner}|${exchange}:${symbol}|${product}`;
const N = (v: unknown) => (v == null ? null : Number(v));

/**
 * In-memory snapshot of every follower that is currently copying: decrypted tokens → pre-built broker
 * adapters, allocation + risk settings, today's trade counts and net copy positions. Loaded at boot and on
 * every connect / disconnect / expiry / settings change (AccountEvents), plus a 60 s safety refresh.
 * The copy engine's hot path reads only from here — no DB, no decryption, no quote calls.
 */
@Injectable()
export class ClientRegistryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ClientRegistry');
  private byStrategy = new Map<string, ClientEntry[]>();
  private skippedByStrategy = new Map<string, SkippedClient[]>();
  private strategies = new Map<string, StrategyInfo>();
  private readonly days = new Map<string, DayState>();
  /** follower net copy positions (followerId|EX:SYM|PRODUCT) and master net positions (strategyId|…) */
  private readonly netPos = new Map<string, number>();
  private readonly masterNet = new Map<string, number>();
  private seededDay = '';
  private reloadTimer?: NodeJS.Timeout;
  private refresh?: NodeJS.Timeout;
  private warm?: NodeJS.Timeout;
  private sub?: Subscription;
  private loading?: Promise<void>;
  loadedAt = 0;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly sessions: BrokerSessionService,
    private readonly trading: TradingService,
    private readonly accountEvents: AccountEvents,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.NODE_ENV === 'test') return;
    this.sub = this.accountEvents.events$.subscribe((e) => {
      // Disconnect/expiry must take effect immediately, before the debounced reload finishes.
      if (e.type === 'disconnected' || e.type === 'expired') this.evictAccount(e.brokerAccountId, `Broker account ${e.type}`);
      this.scheduleReload();
    });
    await this.reload().catch((err) => this.logger.error(`Initial load failed: ${(err as Error).message}`));
    this.refresh = setInterval(() => void this.reload().catch(() => undefined), 60_000);
    this.warm = setInterval(() => this.warmConnections(), 30_000);
    this.warmConnections();
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
    for (const t of [this.reloadTimer]) if (t) clearTimeout(t);
    for (const t of [this.refresh, this.warm]) if (t) clearInterval(t);
  }

  // ------------------------------------------------------------ reads (sync)

  forStrategy(strategyId: string): ClientEntry[] {
    return this.byStrategy.get(strategyId) ?? [];
  }
  skipped(strategyId: string): SkippedClient[] {
    return this.skippedByStrategy.get(strategyId) ?? [];
  }
  strategy(strategyId: string): StrategyInfo | undefined {
    return this.strategies.get(strategyId);
  }
  allEntries(): ClientEntry[] {
    return [...this.byStrategy.values()].flat();
  }

  day(followerId: string): DayState {
    const today = istDay();
    let d = this.days.get(followerId);
    if (!d || d.day !== today) {
      d = { day: today, trades: 0, pnl: null, breached: false };
      this.days.set(followerId, d);
    }
    return d;
  }

  clientNet(followerId: string, ex: string, sym: string, product: ProductType): number {
    return this.netPos.get(posKey(followerId, ex, sym, product)) ?? 0;
  }
  applyClientFill(followerId: string, ex: string, sym: string, product: ProductType, signedQty: number): void {
    const k = posKey(followerId, ex, sym, product);
    this.netPos.set(k, (this.netPos.get(k) ?? 0) + signedQty);
  }
  /** Non-zero net copy positions of a follower (for exit-all). */
  clientPositions(followerId: string): { exchange: Exchange; symbol: string; productType: ProductType; qty: number }[] {
    const out: { exchange: Exchange; symbol: string; productType: ProductType; qty: number }[] = [];
    for (const [k, q] of this.netPos) {
      if (!q || !k.startsWith(`${followerId}|`)) continue;
      const [, inst, product] = k.split('|');
      const [ex, ...sym] = inst!.split(':');
      out.push({ exchange: ex as Exchange, symbol: sym.join(':'), productType: product as ProductType, qty: q });
    }
    return out;
  }
  masterNetOf(strategyId: string, ex: string, sym: string, product: ProductType): number {
    return this.masterNet.get(posKey(strategyId, ex, sym, product)) ?? 0;
  }
  applyMasterFill(strategyId: string, ex: string, sym: string, product: ProductType, signedQty: number): void {
    const k = posKey(strategyId, ex, sym, product);
    this.masterNet.set(k, (this.masterNet.get(k) ?? 0) + signedQty);
  }

  // ------------------------------------------------------------ mutations

  evictAccount(accountId: string, reason: string): void {
    for (const [sid, list] of this.byStrategy) {
      const keep = list.filter((e) => e.accountId !== accountId);
      if (keep.length === list.length) continue;
      const gone = list.filter((e) => e.accountId === accountId);
      this.byStrategy.set(sid, keep);
      this.skippedByStrategy.set(sid, [
        ...(this.skippedByStrategy.get(sid) ?? []),
        ...gone.map((g) => ({ followerId: g.followerId, userId: g.userId, accountId, broker: g.broker, reason, settings: g.settings })),
      ]);
    }
  }

  /** Removes a follower from copying immediately (copy OFF / loss limit). */
  evictFollower(followerId: string): void {
    for (const [sid, list] of this.byStrategy) this.byStrategy.set(sid, list.filter((e) => e.followerId !== followerId));
  }

  scheduleReload(delayMs = 150): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.reload().catch((err) => this.logger.warn(`Reload failed: ${(err as Error).message}`));
    }, delayMs);
  }

  /** Rebuilds the snapshot (off the hot path) and swaps it in atomically. */
  reload(): Promise<void> {
    this.loading ??= this.doReload().finally(() => (this.loading = undefined));
    return this.loading;
  }

  private async doReload(): Promise<void> {
    const started = Date.now();
    const rows = await this.prisma.strategyFollower.findMany({
      where: { copyStatus: 'ON', strategy: { status: 'ACTIVE' } },
      include: { brokerAccount: true, strategy: true },
    });
    const now = Date.now();
    const byStrategy = new Map<string, ClientEntry[]>();
    const skipped = new Map<string, SkippedClient[]>();
    const strategies = new Map<string, StrategyInfo>();
    const adapters = new Map<string, BrokerAdapter | null>();

    for (const r of rows) {
      const s = r.strategy;
      strategies.set(s.id, {
        id: s.id,
        masterUserId: s.masterUserId,
        masterCapital: N(s.masterCapital),
        maxOrderValue: N(s.maxOrderValue),
        maxQuantityPerOrder: s.maxQuantityPerOrder,
        allowedExchanges: s.allowedExchanges,
        allowedInstruments: s.allowedInstruments,
      });
      const a = r.brokerAccount;
      const settings: ClientSettings = {
        allocationMode: r.allocationMode,
        allocationPercent: N(r.allocationPercent),
        allocationAmount: N(r.allocationAmount),
        fixedQuantity: r.fixedQuantity,
        fixedLots: r.fixedLots,
        maxLots: r.maxLots,
        maxQuantity: r.maxQuantity,
        maxTradeValue: N(r.maxTradeValue),
        maxDailyLoss: N(r.maxDailyLoss),
        maxTradesPerDay: r.maxTradesPerDay,
        allowedSegments: r.allowedSegments ?? [],
      };
      const skip = (reason: string) =>
        skipped.set(s.id, [
          ...(skipped.get(s.id) ?? []),
          { followerId: r.id, userId: r.followerUserId, accountId: a?.id ?? null, broker: a?.broker ?? null, reason, settings },
        ]);
      if (!a) {
        skip('No broker account selected');
        continue;
      }
      const simulated = this.trading.isSimulated(a);
      if (!simulated) {
        if (a.mode === 'DATA_ONLY') {
          skip('Account is DATA_ONLY (master) — orders blocked');
          continue;
        }
        if (a.status !== 'CONNECTED') {
          skip(`Broker ${a.status.toLowerCase()}${a.disconnectReason ? `: ${a.disconnectReason}` : ''}`);
          continue;
        }
        if (a.tokenExpiresAt && a.tokenExpiresAt.getTime() <= now) {
          skip('Broker token expired');
          continue;
        }
      }
      let adapter: BrokerAdapter | null = null;
      if (!simulated) {
        if (!adapters.has(a.id)) adapters.set(a.id, await this.buildAdapter(a));
        adapter = adapters.get(a.id) ?? null;
        if (!adapter) {
          skip('Broker session unavailable');
          continue;
        }
      }
      const entry: ClientEntry = {
        followerId: r.id,
        strategyId: s.id,
        userId: r.followerUserId,
        accountId: a.id,
        broker: a.broker,
        brokerClientId: a.brokerClientId,
        simulated,
        adapter,
        tokenExpiresAt: a.tokenExpiresAt?.getTime() ?? null,
        settings,
      };
      byStrategy.set(s.id, [...(byStrategy.get(s.id) ?? []), entry]);
    }

    if (this.seededDay !== istDay()) await this.seedDay();

    this.byStrategy = byStrategy;
    this.skippedByStrategy = skipped;
    this.strategies = strategies;
    this.loadedAt = Date.now();
    const n = rows.length;
    if (n) this.logger.debug?.(`Registry: ${n} followers, ${[...byStrategy.values()].flat().length} ready, ${Date.now() - started} ms`);
  }

  private async buildAdapter(a: BrokerAccount): Promise<BrokerAdapter | null> {
    try {
      const token = await this.sessions.decryptAccess(a);
      return token ? this.trading.buildAdapter(a, token) : null;
    } catch (err) {
      this.logger.warn(`Adapter for ${a.id} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Once per IST day: trade counts + net positions from today's rows (survives restarts). */
  private async seedDay(): Promise<void> {
    const since = startOfTradingDayIST();
    const [orders, masters] = await Promise.all([
      this.prisma.copyOrder.findMany({
        where: { createdAt: { gte: since }, status: { in: ['SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED'] } },
        select: { strategyFollowerId: true, exchange: true, symbol: true, productType: true, side: true, quantity: true },
      }),
      this.prisma.masterTrade.findMany({
        where: { createdAt: { gte: since }, strategyId: { not: null }, status: { in: ['SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED'] } },
        select: { strategyId: true, exchange: true, symbol: true, productType: true, side: true, quantity: true, filledQuantity: true },
      }),
    ]);
    this.netPos.clear();
    this.masterNet.clear();
    this.days.clear();
    for (const o of orders) {
      this.day(o.strategyFollowerId).trades++;
      this.applyClientFill(o.strategyFollowerId, o.exchange, o.symbol, o.productType, o.side === 'BUY' ? o.quantity : -o.quantity);
    }
    for (const m of masters) {
      const q = m.filledQuantity > 0 ? m.filledQuantity : m.quantity;
      this.applyMasterFill(m.strategyId!, m.exchange, m.symbol, m.productType, m.side === 'BUY' ? q : -q);
    }
    this.seededDay = istDay();
  }

  /** Keeps TLS connections to each broker in use warm so the first order of the day is fast. */
  private warmConnections(): void {
    const brokers = new Set(this.allEntries().filter((e) => !e.simulated).map((e) => e.broker));
    for (const b of brokers) {
      const f = ADAPTERS[b];
      if (f) void warmConnection(f.origin, f.proxyUrl?.(this.config));
    }
  }
}
