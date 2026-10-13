import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Subscription } from 'rxjs';
import type { BrokerAccount, Exchange, PrismaClient } from '@ctp/database';
import { type MarketFeedStatus, RedisKeys, WsEvent } from '@ctp/types';
import { BrokerSessionService } from '../brokers/broker-session.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { REDIS } from '../common/redis/redis.module';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { AccountEvents } from '../realtime/account-events';
import { NotifyService } from '../realtime/notify.service';
import { RealtimeService } from '../realtime/realtime.gateway';
import { AngelOneAdapter } from '../trading/angel.adapter';
import { AngelFeed, ANGEL_EXCHANGE_TYPE } from './angel-feed';
import { InstrumentsService } from './instruments.service';
import { KiteTicker } from './kite-ticker';
import { instrumentKey, PriceCacheService } from './price-cache.service';

const SUBS_KEY = 'ctp:feed:subs';
const PREFERRED_KEY = 'ctp:feed:broker';
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** NSE/BSE/NFO cash + F&O hours (IST, weekdays) — used only for stale-feed detection. */
export function isMarketOpen(now = new Date()): boolean {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

/**
 * Master live market data. Uses the master's DATA_ONLY broker account (Zerodha KiteTicker or Angel SmartStream)
 * — this account never places orders. Ticks go to the PriceCache (memory + Redis), which the whole app reads.
 * Auto-reconnects with backoff, and a watchdog restarts the feed when no tick arrives for FEED_STALE_SECONDS
 * during market hours (with an admin/master alert).
 */
@Injectable()
export class MarketFeedService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('MarketFeed');
  private kite?: KiteTicker;
  private angel?: AngelFeed;
  private angelAdapter?: AngelOneAdapter;
  private account?: BrokerAccount;
  private state: MarketFeedStatus['state'] = 'STOPPED';
  private error: string | null = null;
  private reconnects = 0;
  private attempt = 0;
  private restartTimer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;
  private lastMessageAt = 0;
  private startedAt = 0;
  private alerted = false;
  private sub?: Subscription;
  private starting = false;
  /** feed token -> instrument key */
  private readonly tokenToKey = new Map<string, string>();
  private readonly subscribed = new Set<string>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly sessions: BrokerSessionService,
    private readonly prices: PriceCacheService,
    private readonly instruments: InstrumentsService,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifyService,
    private readonly accountEvents: AccountEvents,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.sub = this.accountEvents.events$.subscribe((e) => {
      if (this.account && e.brokerAccountId === this.account.id && e.type !== 'connected' && e.type !== 'settings') {
        this.logger.warn(`Feed account ${e.type} — stopping feed`);
        this.stop(`Master broker account ${e.type}`);
        void this.start();
      } else if (e.type === 'connected' && (!this.account || this.state !== 'LIVE')) {
        void this.start();
      }
    });
    void this.start();
    this.watchdog = setInterval(() => this.check(), 5_000);
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
    if (this.watchdog) clearInterval(this.watchdog);
    this.stop('shutdown');
  }

  // ----------------------------------------------------------------- public

  status(): MarketFeedStatus {
    const last = this.prices.lastTickAt;
    return {
      state: this.state,
      broker: (this.account?.broker as MarketFeedStatus['broker']) ?? null,
      brokerAccountId: this.account?.id ?? null,
      lastTickAt: last ? new Date(last).toISOString() : null,
      lastTickAgoSec: last ? Math.round((Date.now() - last) / 1000) : null,
      subscribed: [...this.subscribed].sort(),
      reconnects: this.reconnects,
      error: this.error,
    };
  }

  async setPreferredBroker(broker: 'ZERODHA' | 'ANGEL_ONE'): Promise<MarketFeedStatus> {
    await this.redis.set(PREFERRED_KEY, broker);
    this.stop('switching broker');
    await this.start();
    return this.status();
  }

  async restart(): Promise<MarketFeedStatus> {
    this.stop('manual restart');
    await this.start();
    return this.status();
  }

  /** Adds instruments ("NSE:INFY") to the persistent subscription list and the live socket. */
  async subscribe(keys: string[]): Promise<void> {
    const norm = keys.map((k) => k.trim().toUpperCase()).filter((k) => /^[A-Z]+:.+$/.test(k));
    const fresh = norm.filter((k) => !this.subscribed.has(k));
    if (!fresh.length) return;
    await this.redis.sadd(SUBS_KEY, ...fresh);
    await this.subscribeLive(fresh);
  }

  async unsubscribe(keys: string[]): Promise<void> {
    const norm = keys.map((k) => k.trim().toUpperCase());
    if (!norm.length) return;
    await this.redis.srem(SUBS_KEY, ...norm);
    for (const k of norm) {
      this.subscribed.delete(k);
      for (const [tok, key] of this.tokenToKey) {
        if (key !== k) continue;
        this.tokenToKey.delete(tok);
        if (this.kite) this.kite.unsubscribe([Number(tok.split(':')[1])]);
      }
    }
  }

  /** Fire-and-forget helper for the copy engine: make sure a traded symbol gets live ticks. */
  ensure(exchange: Exchange, symbol: string): void {
    const k = instrumentKey(exchange, symbol);
    if (!this.subscribed.has(k)) void this.subscribe([k]).catch(() => undefined);
  }

  // ----------------------------------------------------------------- lifecycle

  private async pickAccount(): Promise<BrokerAccount | null> {
    const preferred = (await this.redis.get(PREFERRED_KEY)) as 'ZERODHA' | 'ANGEL_ONE' | null;
    const accounts = await this.prisma.brokerAccount.findMany({
      where: { status: 'CONNECTED', mode: 'DATA_ONLY', broker: { in: ['ZERODHA', 'ANGEL_ONE'] }, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }] },
      orderBy: { lastConnectedAt: 'desc' },
    });
    return accounts.find((a) => a.broker === preferred) ?? accounts[0] ?? null;
  }

  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      if (this.kite || this.angel) return;
      const account = await this.pickAccount();
      if (!account) {
        this.setState('STOPPED', 'No connected master (data) broker account');
        return;
      }
      const token = await this.sessions.decryptAccess(account);
      if (!token) {
        this.setState('STOPPED', 'Master broker token missing — reconnect the master account');
        return;
      }
      this.account = account;
      this.tokenToKey.clear();
      this.subscribed.clear();
      this.setState('CONNECTING', null);
      this.startedAt = Date.now();

      if (account.broker === 'ZERODHA') {
        if (!this.config.ZERODHA_API_KEY) return this.setState('STOPPED', 'ZERODHA_API_KEY not configured');
        const t = new KiteTicker(this.config.ZERODHA_API_KEY, token);
        this.kite = t;
        this.wire(t);
        t.on('tick', (tok: number, ltp: number) => {
          const key = this.tokenToKey.get(`Z:${tok}`) ?? (this.instruments.byInstrumentToken(tok) ? instrumentKey(this.instruments.byInstrumentToken(tok)!.exchange, this.instruments.byInstrumentToken(tok)!.symbol) : undefined);
          if (key) this.prices.set(key, ltp);
        });
        t.connect();
      } else {
        const extra = await this.sessions.decryptExtra(account);
        if (!this.config.ANGEL_API_KEY || !extra.feedToken || !account.brokerClientId) {
          return this.setState('STOPPED', 'Angel feed token missing — reconnect the master Angel One account');
        }
        this.angelAdapter = new AngelOneAdapter(
          { apiKey: this.config.ANGEL_API_KEY, publicIp: this.config.ANGEL_PUBLIC_IP, localIp: this.config.ANGEL_LOCAL_IP, macAddress: this.config.ANGEL_MAC_ADDRESS, proxyUrl: this.config.ANGEL_PROXY_URL },
          token,
          { dataOnly: true },
        );
        const f = new AngelFeed(this.config.ANGEL_API_KEY, account.brokerClientId, extra.feedToken);
        this.angel = f;
        this.wire(f);
        f.on('tick', (exType: number, tok: string, ltp: number) => {
          const key = this.tokenToKey.get(`A:${exType}:${tok}`);
          if (key) this.prices.set(key, ltp);
        });
        f.connect();
      }
      const saved = await this.redis.smembers(SUBS_KEY);
      await this.subscribeLive(saved);
    } catch (err) {
      this.setState('DOWN', (err as Error).message);
      this.scheduleRestart();
    } finally {
      this.starting = false;
    }
  }

  private wire(sock: KiteTicker | AngelFeed): void {
    sock.on('open', () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.setState('LIVE', null);
      this.logger.log(`${this.account?.broker} feed connected`);
    });
    sock.on('message', () => {
      this.lastMessageAt = Date.now();
    });
    sock.on('error', (err: Error) => {
      this.error = err.message;
    });
    sock.on('close', (reason: string) => {
      this.logger.warn(`Feed closed: ${reason}`);
      this.teardownSockets();
      this.setState('DOWN', `Feed closed (${reason})`);
      this.scheduleRestart();
    });
  }

  private async subscribeLive(keys: string[]): Promise<void> {
    if (!keys.length || !this.account) return;
    if (this.kite) {
      const token = await this.sessions.decryptAccess(this.account);
      const exchanges = [...new Set(keys.map((k) => k.split(':')[0]!))];
      await Promise.all(exchanges.map((ex) => this.instruments.ensureExchange(ex, token ?? undefined)));
      const toks: number[] = [];
      for (const k of keys) {
        const [ex, ...rest] = k.split(':');
        const inst = this.instruments.get(ex!, rest.join(':'));
        if (!inst) continue;
        this.tokenToKey.set(`Z:${inst.token}`, k);
        this.subscribed.add(k);
        toks.push(inst.token);
      }
      if (toks.length) this.kite.subscribe(toks);
    } else if (this.angel && this.angelAdapter) {
      for (const k of keys) {
        const [ex, ...rest] = k.split(':');
        const exType = ANGEL_EXCHANGE_TYPE[ex!];
        if (!exType) continue;
        try {
          const inst = await this.angelAdapter.resolve(ex as Exchange, rest.join(':'));
          this.tokenToKey.set(`A:${exType}:${inst.token}`, k);
          this.subscribed.add(k);
          this.angel.subscribe(exType, [inst.token]);
        } catch (err) {
          this.logger.warn(`Angel subscribe ${k} failed: ${(err as Error).message}`);
        }
      }
    }
  }

  private teardownSockets(): void {
    this.kite?.close();
    this.angel?.close();
    this.kite = undefined;
    this.angel = undefined;
  }

  stop(reason: string): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.teardownSockets();
    this.account = undefined;
    this.setState('STOPPED', reason === 'shutdown' ? null : reason);
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    this.reconnects++;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.account = undefined;
      void this.start();
    }, delay);
  }

  /** Watchdog: stale-feed detection, auto-restart, periodic status broadcast. */
  private check(): void {
    // Dead socket (no frames at all — Kite heartbeats every second, Angel pongs every 25 s).
    if (this.state === 'LIVE' && Date.now() - this.lastMessageAt > 90_000) {
      this.logger.warn('Feed socket silent — restarting');
      this.teardownSockets();
      this.setState('DOWN', 'Feed socket silent — restarting');
      this.scheduleRestart();
      return;
    }
    if (this.state === 'LIVE' && isMarketOpen() && this.subscribed.size > 0) {
      const since = Math.max(this.prices.lastTickAt ?? 0, this.startedAt);
      if (Date.now() - since > this.config.FEED_STALE_SECONDS * 1000) {
        this.logger.warn('No ticks — restarting market feed');
        this.teardownSockets();
        this.setState('DOWN', `No ticks for ${this.config.FEED_STALE_SECONDS}s — restarting`);
        this.scheduleRestart();
      }
    }
    if (this.state === 'STOPPED' && !this.starting && !this.restartTimer && Date.now() - this.startedAt > 60_000) {
      this.startedAt = Date.now();
      void this.start(); // pick up a master that connected while we were stopped
    }
    const st = this.status();
    this.realtime.toRole('MASTER', WsEvent.MARKET_FEED_STATUS, st);
    this.realtime.toRole('ADMIN', WsEvent.MARKET_FEED_STATUS, st);
    void this.redis.set(RedisKeys.feedStatus, JSON.stringify(st), 'EX', 60).catch(() => undefined);
  }

  private setState(state: MarketFeedStatus['state'], error: string | null): void {
    const prev = this.state;
    this.state = state;
    this.error = error;
    if (state === 'LIVE') this.alerted = false;
    if (state === 'DOWN' && prev === 'LIVE' && !this.alerted) {
      this.alerted = true;
      const msg = `Live market feed DOWN: ${error ?? 'unknown'} — auto-restarting`;
      void this.notifier.alertAdmins('Market feed down', msg);
      if (this.account) void this.notifier.notify({ userId: this.account.userId, type: 'FEED_DOWN', severity: 'WARNING', title: 'Market feed down', body: msg });
    }
    if (prev !== state) {
      const st = this.status();
      this.realtime.toRole('MASTER', WsEvent.MARKET_FEED_STATUS, st);
      this.realtime.toRole('ADMIN', WsEvent.MARKET_FEED_STATUS, st);
    }
  }
}
