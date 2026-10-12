/**
 * Development seed: demo users, paper (MOCK) broker accounts, a sample strategy
 * and sample instruments. Idempotent — safe to run repeatedly.
 *
 * Refuses to run when APP_ENV=production.
 */
import { loadDotenv } from '@ctp/config';
import { hashPassword } from '@ctp/shared';
import {
  AllocationMode,
  BrokerAccountStatus,
  BrokerName,
  CopyStatus,
  Exchange,
  RiskLevel,
  Role,
  StrategyStatus,
  UserStatus,
} from '@prisma/client';
import { createPrismaClient } from '../src';

loadDotenv(__dirname);
const prisma = createPrismaClient();

const DEV_DEFAULT_PASSWORDS = {
  admin: 'Admin@12345',
  master: 'Master@12345',
  follower: 'Follower@12345',
} as const;

function pw(envName: string, fallback: string): string {
  const v = process.env[envName];
  return v && v.trim() !== '' ? v : fallback;
}

async function upsertUser(params: { email: string; name: string; role: Role; password: string; mobile?: string }) {
  const passwordHash = await hashPassword(params.password);
  return prisma.user.upsert({
    where: { email: params.email },
    update: { name: params.name, role: params.role, status: UserStatus.ACTIVE },
    create: {
      email: params.email,
      name: params.name,
      role: params.role,
      mobile: params.mobile ?? null,
      passwordHash,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
}

async function upsertMockAccount(userId: string, brokerClientId: string) {
  return prisma.brokerAccount.upsert({
    where: { userId_broker: { userId, broker: BrokerName.MOCK } },
    update: { status: BrokerAccountStatus.CONNECTED, isPaper: true },
    create: {
      userId,
      broker: BrokerName.MOCK,
      brokerClientId,
      status: BrokerAccountStatus.CONNECTED,
      isPaper: true,
      lastConnectedAt: new Date(),
    },
  });
}

async function main() {
  if ((process.env.APP_ENV ?? 'development') === 'production') {
    throw new Error('Refusing to seed demo data with APP_ENV=production.');
  }

  const passwords = {
    admin: pw('SEED_ADMIN_PASSWORD', DEV_DEFAULT_PASSWORDS.admin),
    master: pw('SEED_MASTER_PASSWORD', DEV_DEFAULT_PASSWORDS.master),
    follower: pw('SEED_FOLLOWER_PASSWORD', DEV_DEFAULT_PASSWORDS.follower),
  };

  const admin = await upsertUser({ email: 'admin@example.com', name: 'Platform Admin', role: Role.ADMIN, password: passwords.admin });
  const master = await upsertUser({ email: 'master@example.com', name: 'Rahul Sharma', role: Role.MASTER, password: passwords.master, mobile: '+919800000001' });
  const followerA = await upsertUser({ email: 'follower@example.com', name: 'Follower A', role: Role.FOLLOWER, password: passwords.follower, mobile: '+919800000002' });
  const followerB = await upsertUser({ email: 'follower2@example.com', name: 'Follower B', role: Role.FOLLOWER, password: passwords.follower, mobile: '+919800000003' });

  // Paper-trading broker accounts (MOCK broker; no real credentials exist or are needed).
  const masterAcct = await upsertMockAccount(master.id, 'MOCK-MASTER-01');
  const followerAAcct = await upsertMockAccount(followerA.id, 'MOCK-FOLLOWER-A');
  const followerBAcct = await upsertMockAccount(followerB.id, 'MOCK-FOLLOWER-B');

  const existingStrategy = await prisma.strategy.findFirst({
    where: { masterUserId: master.id, name: 'NIFTY Intraday Strategy' },
  });
  const strategy =
    existingStrategy ??
    (await prisma.strategy.create({
      data: {
        masterUserId: master.id,
        name: 'NIFTY Intraday Strategy',
        description: 'Intraday NIFTY index options. Paper-trading demo strategy.',
        riskLevel: RiskLevel.MEDIUM,
        status: StrategyStatus.ACTIVE,
        allowedExchanges: [Exchange.NFO],
        allowedInstruments: ['NIFTY*'],
        maxFollowers: 100,
        masterCapital: '1000000.00',
        maxOrderValue: '200000.00',
        maxQuantityPerOrder: 1800,
      },
    }));

  // Followers subscribe with risk settings — copying stays OFF until they explicitly start it.
  await prisma.strategyFollower.upsert({
    where: { strategyId_followerUserId: { strategyId: strategy.id, followerUserId: followerA.id } },
    update: {},
    create: {
      strategyId: strategy.id,
      followerUserId: followerA.id,
      brokerAccountId: followerAAcct.id,
      allocationMode: AllocationMode.CAPITAL_PERCENTAGE,
      allocationAmount: '100000.00',
      allocationPercent: '20.00',
      maxTradeValue: '10000.00',
      maxDailyLoss: '2000.00',
      maxQuantity: 300,
      maxOpenPositions: 5,
      copyStatus: CopyStatus.OFF,
    },
  });
  await prisma.strategyFollower.upsert({
    where: { strategyId_followerUserId: { strategyId: strategy.id, followerUserId: followerB.id } },
    update: {},
    create: {
      strategyId: strategy.id,
      followerUserId: followerB.id,
      brokerAccountId: followerBAcct.id,
      allocationMode: AllocationMode.CAPITAL_PERCENTAGE,
      allocationAmount: '500000.00',
      allocationPercent: '50.00',
      maxTradeValue: '50000.00',
      maxDailyLoss: '10000.00',
      maxQuantity: 900,
      maxOpenPositions: 10,
      copyStatus: CopyStatus.OFF,
    },
  });

  // SAMPLE instruments for paper trading only. The real instrument master (lot sizes,
  // tick sizes, tokens) is downloaded from the broker in Phase 4 — do not trade on these values.
  const sampleInstruments = [
    { exchange: Exchange.NFO, tradingSymbol: 'NIFTY25000CE', name: 'NIFTY', instrumentType: 'CE', lotSize: 75, strike: '25000' },
    { exchange: Exchange.NFO, tradingSymbol: 'NIFTY25000PE', name: 'NIFTY', instrumentType: 'PE', lotSize: 75, strike: '25000' },
    { exchange: Exchange.NFO, tradingSymbol: 'BANKNIFTY55000CE', name: 'BANKNIFTY', instrumentType: 'CE', lotSize: 35, strike: '55000' },
    { exchange: Exchange.NSE, tradingSymbol: 'RELIANCE', name: 'RELIANCE INDUSTRIES', instrumentType: 'EQ', lotSize: 1, strike: null },
  ];
  for (const i of sampleInstruments) {
    await prisma.instrument.upsert({
      where: { exchange_tradingSymbol: { exchange: i.exchange, tradingSymbol: i.tradingSymbol } },
      update: { lotSize: i.lotSize },
      create: {
        exchange: i.exchange,
        tradingSymbol: i.tradingSymbol,
        name: i.name,
        instrumentType: i.instrumentType,
        segment: i.exchange === Exchange.NFO ? 'NFO-OPT' : 'NSE',
        lotSize: i.lotSize,
        tickSize: '0.05',
        strike: i.strike,
      },
    });
  }

  console.log('Seed complete.');
  console.log('  admin    admin@example.com');
  console.log('  master   master@example.com      (MOCK broker:', masterAcct.brokerClientId + ')');
  console.log('  follower follower@example.com    (MOCK broker:', followerAAcct.brokerClientId + ')');
  console.log('  follower follower2@example.com   (MOCK broker:', followerBAcct.brokerClientId + ')');
  console.log('  strategy', strategy.name, `(${strategy.id})`);
  console.log('Passwords: see README "Seed users" (or the SEED_*_PASSWORD values in your .env).');
  void admin;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
