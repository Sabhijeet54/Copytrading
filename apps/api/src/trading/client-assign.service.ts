import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, Strategy } from '@ctp/database';
import { AuditService } from '../audit/audit.service';
import { PRISMA } from '../common/prisma/prisma.service';
import { AccountEvents } from '../realtime/account-events';
import type { AssignClientDto } from './trading.dto';

/**
 * Master / admin assigns a client to a strategy (instead of the client subscribing himself).
 * The client's first connected TRADING account is used unless one is given. Copying starts only when asked
 * AND the broker is connected — otherwise the client is mapped with copy OFF and can start it later.
 */
@Injectable()
export class ClientAssignService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly accountEvents: AccountEvents,
  ) {}

  async assign(strategy: Strategy, dto: AssignClientDto, actorUserId: string) {
    if (strategy.status === 'ARCHIVED') throw new BadRequestException('Strategy is archived');
    const client = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!client) throw new NotFoundException(`No user with email ${dto.email}`);
    if (client.role !== 'FOLLOWER') throw new BadRequestException('Only client (follower) accounts can be assigned to a strategy');
    if (client.status !== 'ACTIVE') throw new BadRequestException('This client account is not active');

    const accounts = await this.prisma.brokerAccount.findMany({ where: { userId: client.id, mode: 'TRADING' }, orderBy: { createdAt: 'asc' } });
    const account = dto.brokerAccountId
      ? accounts.find((a) => a.id === dto.brokerAccountId)
      : (accounts.find((a) => a.status === 'CONNECTED') ?? accounts.find((a) => a.isPaper || a.broker === 'MOCK') ?? accounts[0]);
    if (dto.brokerAccountId && !account) throw new BadRequestException('That broker account does not belong to this client');

    const existing = await this.prisma.strategyFollower.findUnique({ where: { strategyId_followerUserId: { strategyId: strategy.id, followerUserId: client.id } } });
    if (!existing && strategy.maxFollowers) {
      const n = await this.prisma.strategyFollower.count({ where: { strategyId: strategy.id } });
      if (n >= strategy.maxFollowers) throw new BadRequestException('This strategy is full');
    }
    const mode = dto.allocationMode ?? 'FIXED_QUANTITY';
    if (mode === 'FIXED_QUANTITY' && !dto.fixedQuantity && !dto.fixedLots) throw new BadRequestException('Fixed quantity or fixed lots is required');
    if (mode === 'CAPITAL_PERCENTAGE' && !dto.allocationPercent) throw new BadRequestException('Allocation % is required');
    if (mode === 'PROPORTIONAL' && !dto.allocationAmount) throw new BadRequestException('Capital amount is required');

    const canStart = Boolean(dto.startCopy && account && (account.status === 'CONNECTED' || account.isPaper || account.broker === 'MOCK'));
    const data = {
      brokerAccountId: account?.id ?? null,
      allocationMode: mode,
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
      ...(canStart ? { copyStatus: 'ON' as const, startedAt: new Date(), stoppedAt: null, stoppedReason: null } : {}),
    };
    const row = await this.prisma.strategyFollower.upsert({
      where: { strategyId_followerUserId: { strategyId: strategy.id, followerUserId: client.id } },
      create: { strategyId: strategy.id, followerUserId: client.id, ...data },
      update: data,
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({
      action: 'PROFILE_UPDATED',
      actorUserId,
      targetType: 'StrategyFollower',
      targetId: row.id,
      metadata: { assignedBy: actorUserId, strategyId: strategy.id, clientId: client.id, copy: canStart ? 'ON' : 'OFF' },
    });
    this.accountEvents.emit({ type: 'settings', brokerAccountId: account?.id ?? '', userId: client.id });
    return {
      follower: row,
      warning: dto.startCopy && !canStart ? 'Assigned with copy OFF — the client has no connected broker account yet.' : null,
    };
  }

  /** Removes a client from a strategy: copying stops (history is kept). Positions are not touched. */
  async unassign(strategyId: string, followerId: string, actorUserId: string) {
    const sub = await this.prisma.strategyFollower.findFirst({ where: { id: followerId, strategyId } });
    if (!sub) throw new NotFoundException('Client is not assigned to this strategy');
    const row = await this.prisma.strategyFollower.update({
      where: { id: sub.id },
      data: { copyStatus: 'OFF', stoppedAt: new Date(), stoppedReason: 'Removed from strategy', stoppedByUserId: actorUserId },
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({ action: 'COPY_STOPPED', actorUserId, targetType: 'StrategyFollower', targetId: sub.id, metadata: { reason: 'unassigned' } });
    this.accountEvents.emit({ type: 'settings', brokerAccountId: sub.brokerAccountId ?? '', userId: sub.followerUserId });
    return row;
  }
}
