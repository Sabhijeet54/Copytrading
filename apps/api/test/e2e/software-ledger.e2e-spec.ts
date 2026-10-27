/**
 * End-to-end workflow: software trade ledger vs broker execution (Paper / Live, with and without a broker).
 * Requires PostgreSQL + Redis from .env (docker compose up -d && npm run prisma:deploy). No real broker is
 * contacted: broker adapters are replaced by in-memory fakes.
 *
 * Followers:
 *  A  Paper, no broker                       → paper trade, no broker order
 *  B  Live,  no broker                       → software trade, order NOT SENT
 *  C  Live,  broker connected, fills         → software trade + EXECUTED order
 *  D  Live,  broker connected, broker REJECTS → software trade stays, REJECTED only in Orders
 *  E  Live,  broker connected, partial fill  → software trade full size, PARTIALLY FILLED in Orders
 *  F  Live,  broker connected, placeOrder throws (RMS) → software trade stays, FAILED in Orders
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type Redis from 'ioredis';
import { loadDotenv } from '@ctp/config';
import type { BrokerAccount, Strategy, User } from '@ctp/database';
import { createPrismaClient, PrismaClient } from '@ctp/database';
import { hashPassword } from '@ctp/shared';
import { RedisKeys } from '@ctp/types';
import { AppModule } from '../../src/app.module';
import { BrokerApiError } from '../../src/brokers/broker-http';
import { REDIS } from '../../src/common/redis/redis.module';
import { configureApp } from '../../src/main';
import { PriceCacheService } from '../../src/market-data/price-cache.service';
import type { BrokerAdapter, BrokerOrder, PlaceOrderInput } from '../../src/trading/broker-adapter';
import { ClientRegistryService } from '../../src/trading/client-registry.service';
import { CopyEngineService } from '../../src/trading/copy-engine.service';
import { CopyReconcilerService } from '../../src/trading/copy-reconciler.service';
import { TradingService } from '../../src/trading/trading.service';

loadDotenv(__dirname);

const RUN = randomUUID().slice(0, 8);
const email = (name: string) => `e2e-${RUN}-${name}@example.com`.toLowerCase();
const PASSWORD = 'E2eTestPass123';
const H = { 'X-CTP-Client': 'web' };
const SYMBOL = `NIFTYE2E${RUN.toUpperCase()}FUT`;
const KEY = `NFO:${SYMBOL}`;

let app: NestExpressApplication;
let prisma: PrismaClient;
let redis: Redis;
let registry: ClientRegistryService;
let engine: CopyEngineService;
let reconciler: CopyReconcilerService;
let prices: PriceCacheService;

/** Fake broker per account: records orders, answers order-book queries from a scripted book. */
type Behaviour = 'fill' | 'reject' | 'partial' | 'throw';
const behaviour = new Map<string, Behaviour>();
const placed: { accountId: string; input: PlaceOrderInput; id: string }[] = [];
const book = new Map<string, BrokerOrder[]>();
let orderSeq = 0;

function fakeAdapter(accountId: string): BrokerAdapter {
  return {
    broker: 'ZERODHA',
    async placeOrder(input: PlaceOrderInput) {
      if (behaviour.get(accountId) === 'throw') throw new BrokerApiError('RMS:Rule: Margin Exceeds — insufficient funds', 400);
      const id = `FAKE${++orderSeq}`;
      placed.push({ accountId, input, id });
      return { brokerOrderId: id };
    },
    async modifyOrder() {},
    async cancelOrder() {},
    async orders() {
      return book.get(accountId) ?? [];
    },
    async positions() {
      return [];
    },
    async holdings() {
      return [];
    },
    async funds() {
      return { availableCash: 0, net: 0 };
    },
  } as unknown as BrokerAdapter;
}

/** Broker order book entry for one of our placed orders. */
function respond(accountId: string, brokerOrderId: string, status: BrokerOrder['status'], filled: number, avg: number | null, msg?: string) {
  const p = placed.find((x) => x.id === brokerOrderId)!;
  const list = (book.get(accountId) ?? []).filter((b) => b.brokerOrderId !== brokerOrderId);
  list.push({
    brokerOrderId,
    exchange: p.input.exchange,
    symbol: p.input.symbol,
    side: p.input.side,
    orderType: p.input.orderType,
    productType: p.input.productType,
    quantity: p.input.quantity,
    filledQuantity: filled,
    price: null,
    averagePrice: avg,
    status,
    statusMessage: msg,
    timestamp: new Date(),
    raw: {},
  });
  book.set(accountId, list);
}

async function clearRateLimits() {
  const keys = await redis.keys(`${RedisKeys.rateLimitPrefix}*`);
  if (keys.length) await redis.del(...keys);
}

async function login(e: string) {
  await clearRateLimits();
  const agent = request.agent(app.getHttpServer());
  let res = await agent.post('/auth/login').set(H).send({ email: e, password: PASSWORD });
  if (res.status === 403) res = await agent.post('/auth/login').set(H).send({ email: e, password: PASSWORD, portal: 'staff' });
  expect(res.status).toBe(200);
  return agent;
}

let master: User;
let masterAccount: BrokerAccount;
let strategy: Strategy;
const F: Record<string, { user: User; account: BrokerAccount | null; subId: string; agent: ReturnType<typeof request.agent> }> = {};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  prisma = createPrismaClient();
  redis = app.get(REDIS);
  registry = app.get(ClientRegistryService);
  engine = app.get(CopyEngineService);
  reconciler = app.get(CopyReconcilerService);
  prices = app.get(PriceCacheService);

  // No real broker anywhere: adapters for live accounts are in-memory fakes.
  jest.spyOn(ClientRegistryService.prototype as never, 'buildAdapter' as never).mockImplementation((async (a: BrokerAccount) => fakeAdapter(a.id)) as never);
  jest.spyOn(TradingService.prototype, 'adapterFor').mockImplementation(async (a: BrokerAccount) => fakeAdapter(a.id));

  const hash = await hashPassword(PASSWORD);
  master = await prisma.user.create({ data: { email: email('master'), name: 'E2E Master', role: 'MASTER', passwordHash: hash, emailVerifiedAt: new Date() } });
  masterAccount = await prisma.brokerAccount.create({
    data: { userId: master.id, broker: 'ANGEL_ONE', brokerClientId: `M${RUN}`, status: 'CONNECTED', mode: 'DATA_ONLY', tokenExpiresAt: new Date(Date.now() + 86_400_000) },
  });
  strategy = await prisma.strategy.create({ data: { masterUserId: master.id, name: `E2E Ledger ${RUN}`, status: 'ACTIVE', allowedExchanges: ['NFO'] } });

  const plan: Record<string, { broker: boolean; b?: Behaviour }> = {
    A: { broker: false },
    B: { broker: false },
    C: { broker: true, b: 'fill' },
    D: { broker: true, b: 'reject' },
    E: { broker: true, b: 'partial' },
    F: { broker: true, b: 'throw' },
  };
  for (const [k, p] of Object.entries(plan)) {
    const user = await prisma.user.create({
      data: { email: email(`f${k}`), name: `E2E ${k}`, role: 'FOLLOWER', passwordHash: hash, emailVerifiedAt: new Date(), licenceExpiresAt: new Date(Date.now() + 5 * 86_400_000) },
    });
    const account = p.broker
      ? await prisma.brokerAccount.create({
          data: { userId: user.id, broker: 'ZERODHA', brokerClientId: `${k}${RUN}`, status: 'CONNECTED', mode: 'TRADING', isPaper: true, tokenExpiresAt: new Date(Date.now() + 86_400_000) },
        })
      : null;
    if (account) {
      await prisma.brokerCredential.create({ data: { brokerAccountId: account.id, encryptedAccessToken: 'v1:k1:x:y:z' } });
      behaviour.set(account.id, p.b!);
    }
    // Assigned by the master (copy OFF, no broker account chosen).
    const sub = await prisma.strategyFollower.create({ data: { strategyId: strategy.id, followerUserId: user.id, allocationMode: 'CAPITAL_PERCENTAGE', allocationPercent: 100 } });
    F[k] = { user, account, subId: sub.id, agent: await login(user.email) };
  }
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `e2e-${RUN}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.copyOrder.deleteMany({ where: { followerUserId: { in: ids } } });
  await prisma.masterTrade.deleteMany({ where: { masterUserId: { in: ids } } });
  await prisma.strategy.deleteMany({ where: { masterUserId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearRateLimits();
  jest.restoreAllMocks();
  await prisma.$disconnect();
  await app.close();
});

const masterTrade = (side: 'BUY' | 'SELL', price: number, id: string) =>
  engine.onMasterTrade(strategy, masterAccount, {
    exchange: 'NFO',
    symbol: SYMBOL,
    side,
    quantity: 50,
    filledQuantity: 50,
    averagePrice: price,
    price,
    status: 'FILLED',
    orderType: 'MARKET',
    productType: 'INTRADAY',
    brokerOrderId: `SIG-${RUN}-${id}`,
    timestamp: new Date(),
    lotSize: 50,
    exitReason: 'MASTER_EXIT',
  });

describe('mode switch and activation need no broker', () => {
  it('Live / Paper switch works without a broker, never creates or touches a broker connection', async () => {
    const before = await prisma.brokerAccount.findMany({ where: { userId: { in: Object.values(F).map((f) => f.user.id) }, broker: { not: 'MOCK' } } });
    for (const k of ['B', 'C', 'D', 'E', 'F']) {
      const r = await F[k]!.agent.post('/follow/trading-mode').set(H).send({ mode: 'LIVE' });
      expect(r.status).toBe(200);
      expect(r.body.mode).toBe('LIVE');
    }
    // Re-sending the same mode is a no-op.
    const again = await F.B!.agent.post('/follow/trading-mode').set(H).send({ mode: 'LIVE' });
    expect(again.body.unchanged).toBe(true);
    // A stays on PAPER (default) — switch PAPER → LIVE → PAPER round trip, no broker.
    expect((await F.A!.agent.post('/follow/trading-mode').set(H).send({ mode: 'LIVE' })).status).toBe(200);
    expect((await F.A!.agent.post('/follow/trading-mode').set(H).send({ mode: 'PAPER' })).status).toBe(200);

    const after = await prisma.brokerAccount.findMany({ where: { userId: { in: Object.values(F).map((f) => f.user.id) }, broker: { not: 'MOCK' } } });
    expect(after.length).toBe(before.length); // no broker account created
    for (const a of after) {
      const b = before.find((x) => x.id === a.id)!;
      expect(a.status).toBe(b.status); // not connected / disconnected
      expect(a.tokenExpiresAt?.getTime()).toBe(b.tokenExpiresAt?.getTime()); // no token generated
      expect(a.isPaper).toBe(false); // follows the LIVE switch
    }
    expect(placed.length).toBe(0); // switching never places an order
  });

  it('a client activates a strategy without connecting any broker (Paper and Live)', async () => {
    for (const k of Object.keys(F)) {
      const f = F[k]!;
      const r1 = await f.agent.post(`/follow/strategies/${strategy.id}`).set(H).send({ allocationMode: 'CAPITAL_PERCENTAGE', allocationPercent: 100 });
      expect(r1.status).toBe(201);
      const r2 = await f.agent.post(`/follow/subscriptions/${f.subId}/start`).set(H);
      expect(r2.status).toBe(200);
      expect(r2.body.copyStatus).toBe('ON');
    }
    const dashA = await F.A!.agent.get('/follow/dashboard');
    expect(dashA.body).toMatchObject({ tradingMode: 'PAPER', broker: null });
    const dashB = await F.B!.agent.get('/follow/dashboard');
    expect(dashB.body).toMatchObject({ tradingMode: 'LIVE', broker: null });
    // The paper ledger is not a broker connection: the Broker connection list stays empty.
    expect((await F.A!.agent.get('/brokers/accounts')).body).toEqual([]);
  });
});

describe('strategy trades: software ledger vs broker execution', () => {
  let entryTradeId: Record<string, string> = {};

  it('one entry signal → one software trade per client, whatever the broker does (and no duplicates)', async () => {
    await registry.reload();
    prices.set(KEY, 100);
    const res = await masterTrade('BUY', 100, 'E1');
    expect(res).not.toBeNull();
    // The same signal processed again is ignored (idempotent).
    expect(await masterTrade('BUY', 100, 'E1')).toBeNull();

    // Only the live clients with a broker got a real order — never A (paper) or B (no broker).
    const accountsWithOrders = new Set(placed.map((p) => p.accountId));
    expect(accountsWithOrders.has(F.C!.account!.id)).toBe(true);
    expect(accountsWithOrders.has(F.D!.account!.id)).toBe(true);
    expect(accountsWithOrders.has(F.E!.account!.id)).toBe(true);
    expect(placed.filter((p) => p.input.side === 'BUY').length).toBe(3);

    // Broker responses (order-status reconciliation): C filled, D rejected, E partially filled.
    const idOf = (k: string) => placed.find((p) => p.accountId === F[k]!.account!.id && p.input.side === 'BUY')!.id;
    respond(F.C!.account!.id, idOf('C'), 'FILLED', 50, 101);
    respond(F.D!.account!.id, idOf('D'), 'REJECTED', 0, null, 'RMS: Margin exceeds');
    respond(F.E!.account!.id, idOf('E'), 'CANCELLED', 25, 100.5, 'Partially filled, remaining quantity cancelled');
    await reconciler.run();

    prices.set(KEY, 110);
    for (const k of Object.keys(F)) {
      const t = await F[k]!.agent.get('/follow/trades');
      expect(t.status).toBe(200);
      expect(t.body.rows).toHaveLength(1);
      const row = t.body.rows[0];
      expect(row).toMatchObject({ status: 'OPEN', quantity: 50, entryPrice: 100, side: 'BUY', mode: k === 'A' ? 'PAPER' : 'LIVE' });
      expect(row.unrealizedPnl).toBe(500); // (110 − 100) × 50 — software level, same for everyone
      expect(row).not.toHaveProperty('rejected');
      entryTradeId[k] = row.tradeId;
    }
    const exec = async (k: string) => (await F[k]!.agent.get('/follow/trades')).body.rows[0].execution;
    expect(await exec('A')).toBe('PAPER');
    expect(await exec('B')).toBe('NOT_EXECUTED');
    expect(await exec('C')).toBe('EXECUTED');
    expect(await exec('D')).toBe('NOT_EXECUTED');
    expect(await exec('E')).toBe('PARTIAL');
    expect(await exec('F')).toBe('NOT_EXECUTED');
  });

  it('Orders section shows the actual broker status, linked by Strategy Trade ID', async () => {
    const orderOf = async (k: string) => {
      const r = await F[k]!.agent.get('/follow/orders');
      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(1);
      expect(r.body[0].strategyTradeId).toBe(entryTradeId[k]);
      return r.body[0];
    };
    expect(await orderOf('A')).toMatchObject({ brokerStatus: 'PAPER', brokerOrderId: null });
    const b = await orderOf('B');
    expect(b).toMatchObject({ brokerStatus: 'NOT_SENT', brokerOrderId: null, filledQuantity: 0, averagePrice: null });
    expect(b.errorMessage).toMatch(/Not sent to broker/);
    expect(await orderOf('C')).toMatchObject({ brokerStatus: 'EXECUTED', filledQuantity: 50, averagePrice: '101' });
    const d = await orderOf('D');
    expect(d).toMatchObject({ brokerStatus: 'REJECTED', filledQuantity: 0 });
    expect(d.errorMessage).toMatch(/Margin exceeds/);
    expect(await orderOf('E')).toMatchObject({ brokerStatus: 'PARTIALLY_FILLED', filledQuantity: 25 });
    const f = await orderOf('F');
    expect(f).toMatchObject({ brokerStatus: 'FAILED', brokerOrderId: null });
    expect(f.errorMessage).toMatch(/Margin Exceeds/);
  });

  it('dashboard: software P&L includes rejected / not-sent trades; broker-executed P&L only real fills', async () => {
    const dash = async (k: string) => (await F[k]!.agent.get('/follow/dashboard')).body;
    for (const k of Object.keys(F)) {
      const d = await dash(k);
      expect(d.todayPnl).toBe(500);
      expect(d.software).toMatchObject({ trades: 1, open: 1, closed: 0, unrealizedPnl: 500, realizedPnl: 0 });
      expect(d.strategies[0]).toMatchObject({ todayPnl: 500, todayTrades: 1 });
    }
    expect((await dash('A')).brokerPnl).toBe(0); // paper is never broker P&L
    expect((await dash('B')).brokerPnl).toBe(0); // never sent
    expect((await dash('C')).brokerPnl).toBe(450); // (110 − 101) × 50 at the real fill
    expect((await dash('D')).brokerPnl).toBe(0); // rejected — never executed P&L
    expect((await dash('E')).brokerPnl).toBe(237.5); // (110 − 100.5) × 25 filled
    expect((await dash('F')).brokerPnl).toBe(0);
  });

  it('master exit closes every software trade; exits go to the broker only for what was really held', async () => {
    const buysBefore = placed.length;
    prices.set(KEY, 120);
    expect(await masterTrade('SELL', 120, 'X1')).not.toBeNull();
    const sells = placed.slice(buysBefore);
    // C (50 held) and E (25 held) get a broker exit; D (rejected) and F (failed) hold nothing → no order.
    expect(sells.map((s) => s.accountId).sort()).toEqual([F.C!.account!.id, F.E!.account!.id].sort());
    expect(sells.find((s) => s.accountId === F.E!.account!.id)!.input.quantity).toBe(25);
    respond(F.C!.account!.id, sells.find((s) => s.accountId === F.C!.account!.id)!.id, 'FILLED', 50, 119);
    respond(F.E!.account!.id, sells.find((s) => s.accountId === F.E!.account!.id)!.id, 'FILLED', 25, 119);
    await reconciler.run();

    for (const k of Object.keys(F)) {
      const t = (await F[k]!.agent.get('/follow/trades')).body;
      expect(t.rows).toHaveLength(1);
      expect(t.rows[0]).toMatchObject({ status: 'CLOSED', exitPrice: 120, realizedPnl: 1000, unrealizedPnl: 0, pnl: 1000 });
      expect(t.software).toMatchObject({ trades: 1, open: 0, closed: 1, realizedPnl: 1000 });
    }
    const brokerPnl = async (k: string) => (await F[k]!.agent.get('/follow/dashboard')).body.brokerPnl;
    expect(await brokerPnl('C')).toBe(900); // (119 − 101) × 50
    expect(await brokerPnl('E')).toBe(462.5); // (119 − 100.5) × 25
    expect(await brokerPnl('D')).toBe(0);
    expect(await brokerPnl('B')).toBe(0);

    // Exit orders link back to the same Strategy Trade ID.
    const cOrders = (await F.C!.agent.get('/follow/orders')).body as { isExit: boolean; strategyTradeId: string; brokerStatus: string }[];
    expect(cOrders.find((o) => o.isExit)).toMatchObject({ strategyTradeId: entryTradeId.C, brokerStatus: 'EXECUTED' });
    const bOrders = (await F.B!.agent.get('/follow/orders')).body as { isExit: boolean; strategyTradeId: string; brokerStatus: string }[];
    expect(bOrders.find((o) => o.isExit)).toMatchObject({ strategyTradeId: entryTradeId.B, brokerStatus: 'NOT_SENT' });

    // Paper: the paper position on the internal ledger is closed, no broker order.
    const paper = await prisma.position.findFirst({ where: { userId: F.A!.user.id, symbol: SYMBOL } });
    expect(paper).toMatchObject({ quantity: 0 });
    expect(Number(paper!.realizedPnl)).toBe(1000);
  });

  it('switching modes afterwards neither re-sends orders nor changes recorded trades', async () => {
    const n = placed.length;
    expect((await F.C!.agent.post('/follow/trading-mode').set(H).send({ mode: 'PAPER' })).status).toBe(200);
    expect((await F.C!.agent.post('/follow/trading-mode').set(H).send({ mode: 'LIVE' })).status).toBe(200);
    expect(placed.length).toBe(n);
    const t = (await F.C!.agent.get('/follow/trades')).body;
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ tradeId: entryTradeId.C, mode: 'LIVE', status: 'CLOSED', pnl: 1000 });
    const acc = await prisma.brokerAccount.findUnique({ where: { id: F.C!.account!.id } });
    expect(acc).toMatchObject({ status: 'CONNECTED' });
  });

  it('PAPER → LIVE closes open paper trades in the software only; later live trades without a broker are recorded, not sent', async () => {
    prices.set(KEY, 130);
    expect(await masterTrade('BUY', 130, 'E2')).not.toBeNull();
    let a = (await F.A!.agent.get('/follow/trades')).body;
    const open = a.rows.find((r: { status: string }) => r.status === 'OPEN');
    expect(open).toMatchObject({ mode: 'PAPER', entryPrice: 130 });
    prices.set(KEY, 135);
    const n = placed.length;
    const sw = await F.A!.agent.post('/follow/trading-mode').set(H).send({ mode: 'LIVE' });
    expect(sw.body).toMatchObject({ mode: 'LIVE', paperClosed: 1 });
    expect(placed.length).toBe(n); // simulated close — no broker order
    a = (await F.A!.agent.get('/follow/trades')).body;
    expect(a.rows.find((r: { tradeId: string }) => r.tradeId === open.tradeId)).toMatchObject({ status: 'CLOSED', exitPrice: 135, pnl: 250 });

    // Master exits: A is LIVE without a broker → exit recorded as NOT SENT, never a broker order, no phantom paper short.
    expect(await masterTrade('SELL', 140, 'X2')).not.toBeNull();
    const pos = await prisma.position.findFirst({ where: { userId: F.A!.user.id, symbol: SYMBOL } });
    expect(pos?.quantity).toBe(0);
    const orders = (await F.A!.agent.get('/follow/orders')).body as { brokerStatus: string; isExit: boolean }[];
    expect(orders.filter((o) => o.isExit).map((o) => o.brokerStatus)).toEqual(expect.arrayContaining(['PAPER']));
    expect(placed.some((p) => !Object.values(F).some((f) => f.account?.id === p.accountId))).toBe(false);
  });
});

