import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@ctp/database';
import type Redis from 'ioredis';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AdminDashboardStats,
  AdminUserDetail,
  AdminUserListItem,
  AuditLogView,
  BrokerAccountView,
  CopyHaltState,
  CopyOrderView,
  MasterTradeView,
  Paginated,
  PositionView,
  RedisKeys,
  StrategyView,
  SystemEventView,
  SystemHealthDetail,
} from '@ctp/types';
import { AuditService } from '../audit/audit.service';
import { TokenService, ClientInfo } from '../auth/token.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import {
  toAdminUserListItem,
  toAuditLogView,
  toBrokerAccountView,
  toCopyOrderView,
  toMasterTradeView,
  toPositionView,
  toStrategyFollowerView,
  toStrategyView,
  toSystemEventView,
} from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { REDIS } from '../common/redis/redis.module';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { HealthService } from '../health/health.service';
import {
  AdminAuditLogsQueryDto,
  AdminBrokerAccountsQueryDto,
  AdminCopyOrdersQueryDto,
  AdminMasterTradesQueryDto,
  AdminPositionsQueryDto,
  AdminStrategiesQueryDto,
  AdminSystemEventsQueryDto,
  AdminUsersQueryDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Midnight in India (IST, UTC+05:30) for the current trading day, as a UTC Date. */
export function startOfTradingDayIST(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) };
}

function readVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

@Injectable()
export class AdminService {
  private readonly startedAt = Date.now();
  private readonly version = readVersion();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly health: HealthService,
  ) {}

  // ------------------------------------------------------------------ dashboard

  async dashboard(): Promise<AdminDashboardStats> {
    const today = startOfTradingDayIST();
    const [
      totalUsers,
      connectedAccounts,
      activeMasters,
      activeFollowerGroups,
      activeStrategies,
      todaysMasterTrades,
      successfulCopyOrders,
      failedCopyOrders,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.brokerAccount.count({ where: { status: 'CONNECTED' } }),
      this.prisma.user.count({ where: { role: 'MASTER', status: 'ACTIVE', strategies: { some: { status: 'ACTIVE' } } } }),
      this.prisma.strategyFollower.groupBy({ by: ['followerUserId'], where: { copyStatus: 'ON' } }),
      this.prisma.strategy.count({ where: { status: 'ACTIVE' } }),
      this.prisma.masterTrade.count({ where: { createdAt: { gte: today } } }),
      this.prisma.copyOrder.count({ where: { createdAt: { gte: today }, status: 'FILLED' } }),
      this.prisma.copyOrder.count({ where: { createdAt: { gte: today }, status: { in: ['FAILED', 'REJECTED'] } } }),
    ]);
    return {
      totalUsers,
      connectedAccounts,
      activeMasters,
      activeFollowers: activeFollowerGroups.length,
      activeStrategies,
      todaysMasterTrades,
      successfulCopyOrders,
      failedCopyOrders,
      paperMode: this.config.PAPER_MODE,
    };
  }

  // ------------------------------------------------------------------ users

  async listUsers(q: AdminUsersQueryDto): Promise<Paginated<AdminUserListItem>> {
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.broker ? { brokerAccounts: { some: { broker: q.broker } } } : {}),
      ...(q.search
        ? {
            OR: [
              { email: { contains: q.search, mode: 'insensitive' } },
              { name: { contains: q.search, mode: 'insensitive' } },
              { mobile: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { brokerAccounts: { select: { id: true, broker: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(toAdminUserListItem), total, page: q.page, pageSize: q.pageSize };
  }

  async getUser(id: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        brokerAccounts: { orderBy: { createdAt: 'asc' } },
        follows: { include: { strategy: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
        strategies: { include: { _count: { select: { followers: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      ...toAdminUserListItem(user),
      brokerAccounts: user.brokerAccounts.map(toBrokerAccountView),
      follows: user.follows.map(toStrategyFollowerView),
      strategies: user.strategies.map((s) => toStrategyView(s)),
    };
  }

  /**
   * Disabling a user: revokes every session immediately, stops all of their copy subscriptions
   * and, for masters, pauses their active strategies so no follower copies their trades.
   * Re-enabling does NOT restart copying — the user must explicitly start it again.
   */
  async setUserStatus(admin: RequestUser, id: string, dto: UpdateUserStatusDto, client: ClientInfo): Promise<AdminUserDetail> {
    if (id === admin.id) throw new BadRequestException('You cannot change the status of your own account');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.status === 'DISABLED') {
      if (!dto.reason) throw new BadRequestException('A reason is required to disable a user');
      if (user.status === 'DISABLED') throw new BadRequestException('User is already disabled');
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { status: 'DISABLED', disabledAt: now, disabledReason: dto.reason } });
        const activeFollows = await tx.strategyFollower.findMany({ where: { followerUserId: id, copyStatus: { not: 'OFF' } } });
        if (activeFollows.length) {
          await tx.strategyFollower.updateMany({
            where: { id: { in: activeFollows.map((f) => f.id) } },
            data: { copyStatus: 'OFF', stoppedAt: now, stoppedReason: 'Account disabled by admin', stoppedByUserId: admin.id },
          });
          for (const f of activeFollows) {
            await this.audit.logTx(tx, {
              action: 'COPY_STOPPED',
              actorUserId: admin.id,
              targetType: 'StrategyFollower',
              targetId: f.id,
              metadata: { reason: 'user_disabled', followerUserId: id, strategyId: f.strategyId },
              client,
            });
          }
        }
        const pausedStrategies = await tx.strategy.updateMany({
          where: { masterUserId: id, status: 'ACTIVE' },
          data: { status: 'PAUSED' },
        });
        await this.audit.logTx(tx, {
          action: 'ADMIN_DISABLED_USER',
          actorUserId: admin.id,
          targetType: 'User',
          targetId: id,
          metadata: { reason: dto.reason, stoppedFollows: activeFollows.length, pausedStrategies: pausedStrategies.count },
          client,
        });
      });
      await this.tokens.revokeAllForUser(id);
    } else {
      if (user.status === 'ACTIVE') throw new BadRequestException('User is already active');
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { status: 'ACTIVE', disabledAt: null, disabledReason: null } });
        await this.audit.logTx(tx, {
          action: 'ADMIN_ENABLED_USER',
          actorUserId: admin.id,
          targetType: 'User',
          targetId: id,
          metadata: dto.reason ? { reason: dto.reason } : undefined,
          client,
        });
      });
    }
    return this.getUser(id);
  }

  // ------------------------------------------------------------------ broker accounts

  async listBrokerAccounts(q: AdminBrokerAccountsQueryDto): Promise<Paginated<BrokerAccountView & { userName: string; userEmail: string }>> {
    const where: Prisma.BrokerAccountWhereInput = {
      ...(q.broker ? { broker: q.broker } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.brokerAccount.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.brokerAccount.count({ where }),
    ]);
    return {
      items: items.map((a) => ({ ...toBrokerAccountView(a), userName: a.user.name, userEmail: a.user.email })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Revokes the platform's access to a broker account: deletes the encrypted credentials,
   * marks the account DISCONNECTED and stops any copy subscriptions that trade through it.
   * (Invalidating the session on the broker's side is done by the broker adapter once
   * real adapters exist — see Phase 4/5.)
   */
  async disconnectBrokerAccount(admin: RequestUser, id: string, reason: string, client: ClientInfo): Promise<BrokerAccountView> {
    const account = await this.prisma.brokerAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Broker account not found');
    if (account.status === 'DISCONNECTED') throw new BadRequestException('Broker account is already disconnected');
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.brokerCredential.deleteMany({ where: { brokerAccountId: id } });
      const result = await tx.brokerAccount.update({
        where: { id },
        data: { status: 'DISCONNECTED', tokenExpiresAt: null, lastError: `Disconnected by admin: ${reason}` },
      });
      const stopped = await tx.strategyFollower.updateMany({
        where: { brokerAccountId: id, copyStatus: { not: 'OFF' } },
        data: { copyStatus: 'OFF', stoppedAt: now, stoppedReason: 'Broker account disconnected by admin', stoppedByUserId: admin.id },
      });
      await this.audit.logTx(tx, {
        action: 'ADMIN_DISCONNECTED_BROKER',
        actorUserId: admin.id,
        targetType: 'BrokerAccount',
        targetId: id,
        metadata: { reason, broker: account.broker, userId: account.userId, stoppedFollows: stopped.count },
        client,
      });
      await this.audit.logTx(tx, {
        action: 'BROKER_DISCONNECTED',
        actorUserId: admin.id,
        targetType: 'BrokerAccount',
        targetId: id,
        metadata: { broker: account.broker, userId: account.userId, initiatedBy: 'admin' },
        client,
      });
      return result;
    });
    return toBrokerAccountView(updated);
  }

  // ------------------------------------------------------------------ strategies & copy control

  async listStrategies(q: AdminStrategiesQueryDto): Promise<Paginated<StrategyView>> {
    const where: Prisma.StrategyWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.masterUserId ? { masterUserId: q.masterUserId } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.strategy.findMany({
        where,
        include: { master: { select: { name: true } }, _count: { select: { followers: true } } },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.strategy.count({ where }),
    ]);
    const active = await this.prisma.strategyFollower.groupBy({
      by: ['strategyId'],
      where: { strategyId: { in: items.map((s) => s.id) }, copyStatus: 'ON' },
      _count: { _all: true },
    });
    const activeMap = new Map(active.map((a) => [a.strategyId, a._count._all]));
    return {
      items: items.map((s) => toStrategyView(s, activeMap.get(s.id) ?? 0)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async listStrategyFollowers(strategyId: string) {
    const follows = await this.prisma.strategyFollower.findMany({
      where: { strategyId },
      include: { follower: { select: { name: true } }, strategy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return follows.map(toStrategyFollowerView);
  }

  async pauseStrategy(admin: RequestUser, id: string, reason: string, client: ClientInfo): Promise<StrategyView> {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (strategy.status !== 'ACTIVE') throw new BadRequestException('Only an ACTIVE strategy can be paused');
    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.strategy.update({
        where: { id },
        data: { status: 'PAUSED' },
        include: { master: { select: { name: true } }, _count: { select: { followers: true } } },
      });
      await this.audit.logTx(tx, {
        action: 'STRATEGY_STOPPED',
        actorUserId: admin.id,
        targetType: 'Strategy',
        targetId: id,
        metadata: { reason, initiatedBy: 'admin' },
        client,
      });
      return s;
    });
    return toStrategyView(updated);
  }

  async stopFollowerCopy(admin: RequestUser, followId: string, reason: string, client: ClientInfo) {
    const follow = await this.prisma.strategyFollower.findUnique({ where: { id: followId } });
    if (!follow) throw new NotFoundException('Subscription not found');
    if (follow.copyStatus === 'OFF') throw new BadRequestException('Copy trading is already off for this subscription');
    const updated = await this.prisma.$transaction(async (tx) => {
      const f = await tx.strategyFollower.update({
        where: { id: followId },
        data: { copyStatus: 'OFF', stoppedAt: new Date(), stoppedReason: `Stopped by admin: ${reason}`, stoppedByUserId: admin.id },
        include: { follower: { select: { name: true } }, strategy: { select: { name: true } } },
      });
      await this.audit.logTx(tx, {
        action: 'ADMIN_STOPPED_COPY',
        actorUserId: admin.id,
        targetType: 'StrategyFollower',
        targetId: followId,
        metadata: { reason, followerUserId: follow.followerUserId, strategyId: follow.strategyId },
        client,
      });
      await this.audit.logTx(tx, {
        action: 'COPY_STOPPED',
        actorUserId: admin.id,
        targetType: 'StrategyFollower',
        targetId: followId,
        metadata: { initiatedBy: 'admin', followerUserId: follow.followerUserId, strategyId: follow.strategyId },
        client,
      });
      return f;
    });
    return toStrategyFollowerView(updated);
  }

  async copyHaltState(): Promise<CopyHaltState | null> {
    const raw = await this.redis.get(RedisKeys.copyHalted);
    return raw ? (JSON.parse(raw) as CopyHaltState) : null;
  }

  /** Platform-wide kill switch. The copy engine checks this flag before creating or submitting any order. */
  async haltCopyTrading(admin: RequestUser, reason: string, client: ClientInfo): Promise<CopyHaltState> {
    const state: CopyHaltState = { haltedAt: new Date().toISOString(), haltedByUserId: admin.id, reason };
    // Halt first (fail-safe): even if recording the event below fails, copying is already stopped.
    await this.redis.set(RedisKeys.copyHalted, JSON.stringify(state));
    await this.prisma.$transaction(async (tx) => {
      await tx.systemEvent.create({
        data: { source: 'API', type: 'COPY_TRADING_HALTED', severity: 'CRITICAL', message: `Copy trading halted by admin: ${reason}`, context: { adminUserId: admin.id } },
      });
      await this.audit.logTx(tx, { action: 'ADMIN_STOPPED_COPY', actorUserId: admin.id, targetType: 'Platform', metadata: { scope: 'GLOBAL', reason }, client });
    });
    return state;
  }

  async resumeCopyTrading(admin: RequestUser, reason: string, client: ClientInfo): Promise<{ halted: false }> {
    if (!(await this.copyHaltState())) throw new BadRequestException('Copy trading is not halted');
    // Record first, then lift the halt: if recording fails the platform stays halted (fail-safe).
    await this.prisma.$transaction(async (tx) => {
      await tx.systemEvent.create({
        data: { source: 'API', type: 'COPY_TRADING_RESUMED', severity: 'WARNING', message: `Copy trading resumed by admin: ${reason}`, context: { adminUserId: admin.id } },
      });
      await this.audit.logTx(tx, { action: 'ADMIN_RESUMED_COPY', actorUserId: admin.id, targetType: 'Platform', metadata: { scope: 'GLOBAL', reason }, client });
    });
    await this.redis.del(RedisKeys.copyHalted);
    return { halted: false };
  }

  // ------------------------------------------------------------------ trades / orders / positions

  async listMasterTrades(q: AdminMasterTradesQueryDto): Promise<Paginated<MasterTradeView>> {
    const where: Prisma.MasterTradeWhereInput = {
      ...(q.broker ? { broker: q.broker } : {}),
      ...(q.userId ? { masterUserId: q.userId } : {}),
      ...(q.strategyId ? { strategyId: q.strategyId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.symbol ? { symbol: { contains: q.symbol, mode: 'insensitive' } } : {}),
      ...(dateRange(q.from, q.to) ? { createdAt: dateRange(q.from, q.to) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.masterTrade.findMany({
        where,
        include: { master: { select: { name: true } }, _count: { select: { copyOrders: true } } },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.masterTrade.count({ where }),
    ]);
    return { items: items.map(toMasterTradeView), total, page: q.page, pageSize: q.pageSize };
  }

  async listCopyOrders(q: AdminCopyOrdersQueryDto): Promise<Paginated<CopyOrderView>> {
    const where: Prisma.CopyOrderWhereInput = {
      ...(q.broker ? { broker: q.broker } : {}),
      ...(q.userId ? { followerUserId: q.userId } : {}),
      ...(q.strategyId ? { strategyFollower: { strategyId: q.strategyId } } : {}),
      ...(q.masterTradeId ? { masterTradeId: q.masterTradeId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(dateRange(q.from, q.to) ? { createdAt: dateRange(q.from, q.to) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.copyOrder.findMany({
        where,
        include: { follower: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.copyOrder.count({ where }),
    ]);
    return { items: items.map(toCopyOrderView), total, page: q.page, pageSize: q.pageSize };
  }

  async listPositions(q: AdminPositionsQueryDto): Promise<Paginated<PositionView>> {
    const where: Prisma.PositionWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.broker ? { brokerAccount: { broker: q.broker } } : {}),
      ...(q.scope !== 'all' ? { quantity: { not: 0 } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.position.findMany({
        where,
        include: { user: { select: { name: true } }, brokerAccount: { select: { broker: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.position.count({ where }),
    ]);
    return { items: items.map(toPositionView), total, page: q.page, pageSize: q.pageSize };
  }

  // ------------------------------------------------------------------ audit & health

  async listAuditLogs(q: AdminAuditLogsQueryDto): Promise<Paginated<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.userId ? { OR: [{ actorUserId: q.userId }, { targetType: 'User', targetId: q.userId }] } : {}),
      ...(dateRange(q.from, q.to) ? { createdAt: dateRange(q.from, q.to) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: items.map(toAuditLogView), total, page: q.page, pageSize: q.pageSize };
  }

  async listSystemEvents(q: AdminSystemEventsQueryDto): Promise<Paginated<SystemEventView>> {
    const where: Prisma.SystemEventWhereInput = q.severity ? { severity: q.severity } : {};
    const [items, total] = await Promise.all([
      this.prisma.systemEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.systemEvent.count({ where }),
    ]);
    return { items: items.map(toSystemEventView), total, page: q.page, pageSize: q.pageSize };
  }

  async systemHealth(): Promise<SystemHealthDetail & { copyHalt: CopyHaltState | null }> {
    const [basic, heartbeat, recent, copyHalt] = await Promise.all([
      this.health.check(),
      this.health.workerHeartbeat(),
      this.prisma.systemEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.copyHaltState(),
    ]);
    return {
      ...basic,
      api: {
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        version: this.version,
        environment: this.config.APP_ENV,
        paperMode: this.config.PAPER_MODE,
      },
      workerHeartbeat: { lastSeenAt: heartbeat?.at ?? null, pid: heartbeat?.pid ?? null, host: heartbeat?.host ?? null },
      // Populated once BullMQ queues (Phase 3) and broker order streams (Phase 4/5) exist.
      queues: [],
      brokerStreams: [],
      recentEvents: recent.map(toSystemEventView),
      copyHalt,
    };
  }
}
