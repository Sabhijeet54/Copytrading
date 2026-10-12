/**
 * Explicit entity → API view mappers. Every response goes through one of these so that
 * secrets (password hashes, encrypted broker tokens) can never leak via a stray `include`.
 */
import type {
  AuditLog,
  BrokerAccount,
  CopyOrder,
  MasterTrade,
  Position,
  Prisma,
  Strategy,
  StrategyFollower,
  SystemEvent,
  User,
} from '@ctp/database';
import type {
  AdminUserListItem,
  AuditLogView,
  AuthUser,
  BrokerAccountView,
  CopyOrderView,
  MasterTradeView,
  PositionView,
  StrategyFollowerView,
  StrategyView,
  SystemEventView,
} from '@ctp/types';

type Dec = Prisma.Decimal | null | undefined;
const dec = (v: Dec): string | null => (v === null || v === undefined ? null : v.toString());
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const json = (v: Prisma.JsonValue | null): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    mobile: u.mobile,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

export function tokenStatus(a: Pick<BrokerAccount, 'status' | 'tokenExpiresAt' | 'isPaper'>): BrokerAccountView['tokenStatus'] {
  if (a.status !== 'CONNECTED') return a.status === 'EXPIRED' ? 'EXPIRED' : 'NONE';
  if (a.isPaper) return 'ACTIVE';
  if (!a.tokenExpiresAt) return 'NONE';
  return a.tokenExpiresAt.getTime() > Date.now() ? 'ACTIVE' : 'EXPIRED';
}

export function toBrokerAccountView(a: BrokerAccount): BrokerAccountView {
  return {
    id: a.id,
    userId: a.userId,
    broker: a.broker,
    brokerClientId: a.brokerClientId,
    status: a.status,
    isPaper: a.isPaper,
    tokenExpiresAt: iso(a.tokenExpiresAt),
    tokenStatus: tokenStatus(a),
    lastConnectedAt: iso(a.lastConnectedAt),
    lastError: a.lastError,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toAdminUserListItem(u: User & { brokerAccounts: Pick<BrokerAccount, 'id' | 'broker' | 'status'>[] }): AdminUserListItem {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    mobile: u.mobile,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerifiedAt !== null,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
    brokerAccounts: u.brokerAccounts.map((b) => ({ id: b.id, broker: b.broker, status: b.status })),
  };
}

export function toStrategyView(
  s: Strategy & { master?: Pick<User, 'name'>; _count?: { followers?: number } },
  activeFollowerCount?: number,
): StrategyView {
  return {
    id: s.id,
    masterUserId: s.masterUserId,
    masterName: s.master?.name,
    name: s.name,
    description: s.description,
    riskLevel: s.riskLevel,
    status: s.status,
    allowedExchanges: s.allowedExchanges,
    allowedInstruments: s.allowedInstruments,
    maxFollowers: s.maxFollowers,
    masterCapital: s.masterCapital.toString(),
    followerCount: s._count?.followers,
    activeFollowerCount,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toStrategyFollowerView(
  f: StrategyFollower & { strategy?: Pick<Strategy, 'name'>; follower?: Pick<User, 'name'> },
): StrategyFollowerView {
  return {
    id: f.id,
    strategyId: f.strategyId,
    strategyName: f.strategy?.name,
    followerUserId: f.followerUserId,
    followerName: f.follower?.name,
    brokerAccountId: f.brokerAccountId,
    allocationMode: f.allocationMode,
    allocationAmount: dec(f.allocationAmount),
    allocationPercent: dec(f.allocationPercent),
    fixedQuantity: f.fixedQuantity,
    riskLevel: f.riskLevel,
    maxTradeValue: dec(f.maxTradeValue),
    maxDailyLoss: dec(f.maxDailyLoss),
    maxQuantity: f.maxQuantity,
    maxOpenPositions: f.maxOpenPositions,
    copyStatus: f.copyStatus,
    startedAt: iso(f.startedAt),
    stoppedAt: iso(f.stoppedAt),
    stoppedReason: f.stoppedReason,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export function toMasterTradeView(
  t: MasterTrade & { master?: Pick<User, 'name'>; _count?: { copyOrders?: number } },
): MasterTradeView {
  return {
    id: t.id,
    masterUserId: t.masterUserId,
    masterName: t.master?.name,
    strategyId: t.strategyId,
    brokerAccountId: t.brokerAccountId,
    broker: t.broker,
    brokerOrderId: t.brokerOrderId,
    exchange: t.exchange,
    symbol: t.symbol,
    instrumentToken: t.instrumentToken,
    side: t.side,
    orderType: t.orderType,
    productType: t.productType,
    quantity: t.quantity,
    filledQuantity: t.filledQuantity,
    price: dec(t.price),
    averagePrice: dec(t.averagePrice),
    status: t.status,
    eventTimestamp: t.eventTimestamp.toISOString(),
    createdAt: t.createdAt.toISOString(),
    copyOrderCount: t._count?.copyOrders,
  };
}

export function toCopyOrderView(o: CopyOrder & { follower?: Pick<User, 'name'> }): CopyOrderView {
  return {
    id: o.id,
    masterTradeId: o.masterTradeId,
    followerUserId: o.followerUserId,
    followerName: o.follower?.name,
    brokerAccountId: o.brokerAccountId,
    broker: o.broker,
    exchange: o.exchange,
    symbol: o.symbol,
    side: o.side,
    orderType: o.orderType,
    productType: o.productType,
    quantity: o.quantity,
    filledQuantity: o.filledQuantity,
    averagePrice: dec(o.averagePrice),
    status: o.status,
    brokerOrderId: o.brokerOrderId,
    errorCode: o.errorCode,
    errorMessage: o.errorMessage,
    attempts: o.attempts,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toPositionView(
  p: Position & { user?: Pick<User, 'name'>; brokerAccount?: Pick<BrokerAccount, 'broker'> },
): PositionView {
  return {
    id: p.id,
    userId: p.userId,
    userName: p.user?.name,
    brokerAccountId: p.brokerAccountId,
    broker: p.brokerAccount?.broker,
    exchange: p.exchange,
    symbol: p.symbol,
    productType: p.productType,
    quantity: p.quantity,
    averagePrice: p.averagePrice.toString(),
    lastPrice: dec(p.lastPrice),
    realizedPnl: p.realizedPnl.toString(),
    unrealizedPnl: p.unrealizedPnl.toString(),
    isPaper: p.isPaper,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toAuditLogView(a: AuditLog & { actor?: Pick<User, 'email'> | null }): AuditLogView {
  return {
    id: a.id,
    actorUserId: a.actorUserId,
    actorEmail: a.actor?.email ?? null,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    metadata: json(a.metadata),
    ip: a.ip,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toSystemEventView(e: SystemEvent): SystemEventView {
  return {
    id: e.id,
    source: e.source,
    type: e.type,
    severity: e.severity,
    message: e.message,
    context: json(e.context),
    resolvedAt: iso(e.resolvedAt),
    createdAt: e.createdAt.toISOString(),
  };
}
