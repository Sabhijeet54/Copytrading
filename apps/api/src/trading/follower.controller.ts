import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@ctp/database';
import { AuditService } from '../audit/audit.service';
import { clientInfo } from '../common/client-info';
import { CurrentUser, RequestUser, Roles } from '../common/decorators/auth.decorators';
import { toCopyOrderView, toStrategyFollowerView, toStrategyView } from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { FollowDto } from './trading.dto';
import { TradingService } from './trading.service';

/** Client (follower) side: discover strategies, subscribe, start/stop copying, and see own portfolio. */
@Roles('FOLLOWER')
@Controller('follow')
export class FollowerController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly trading: TradingService,
    private readonly audit: AuditService,
  ) {}

  @Get('strategies')
  async strategies(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.strategy.findMany({
      where: { status: { in: ['ACTIVE', 'PAUSED'] } },
      include: { master: { select: { name: true } }, _count: { select: { followers: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const mine = await this.prisma.strategyFollower.findMany({ where: { followerUserId: user.id } });
    const byStrategy = new Map(mine.map((m) => [m.strategyId, m]));
    return rows.map((s) => {
      const sub = byStrategy.get(s.id);
      return { ...toStrategyView(s), subscription: sub ? toStrategyFollowerView(sub) : null };
    });
  }

  @Get('subscriptions')
  async subscriptions(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.strategyFollower.findMany({
      where: { followerUserId: user.id },
      include: { strategy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toStrategyFollowerView);
  }

  /** Subscribe to a strategy or update the allocation. Copying stays OFF until started explicitly. */
  @Post('strategies/:id')
  async follow(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: FollowDto, @Req() req: Request) {
    const s = await this.prisma.strategy.findUnique({ where: { id }, include: { _count: { select: { followers: true } } } });
    if (!s || s.status === 'ARCHIVED' || s.status === 'DRAFT') throw new NotFoundException('Strategy not available');
    const account = await this.prisma.brokerAccount.findFirst({ where: { id: dto.brokerAccountId, userId: user.id } });
    if (!account) throw new BadRequestException('Choose one of your broker accounts');
    if (dto.allocationMode === 'FIXED_QUANTITY' && !dto.fixedQuantity) throw new BadRequestException('Fixed quantity is required');
    if (dto.allocationMode === 'CAPITAL_PERCENTAGE' && !dto.allocationPercent) throw new BadRequestException('Allocation % is required');
    if (dto.allocationMode === 'PROPORTIONAL' && !dto.allocationAmount) throw new BadRequestException('Capital amount is required');
    const existing = await this.prisma.strategyFollower.findUnique({ where: { strategyId_followerUserId: { strategyId: id, followerUserId: user.id } } });
    if (!existing && s.maxFollowers && s._count.followers >= s.maxFollowers) throw new BadRequestException('This strategy is full');
    const data = {
      brokerAccountId: account.id,
      allocationMode: dto.allocationMode,
      allocationAmount: dto.allocationAmount ?? null,
      allocationPercent: dto.allocationPercent ?? null,
      fixedQuantity: dto.fixedQuantity ?? null,
      maxQuantity: dto.maxQuantity ?? null,
      maxTradeValue: dto.maxTradeValue ?? null,
    };
    const row = await this.prisma.strategyFollower.upsert({
      where: { strategyId_followerUserId: { strategyId: id, followerUserId: user.id } },
      create: { strategyId: id, followerUserId: user.id, ...data },
      update: data,
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({ action: 'PROFILE_UPDATED', actorUserId: user.id, targetType: 'StrategyFollower', targetId: row.id, metadata: { strategyId: id, ...dto }, client: clientInfo(req) });
    return toStrategyFollowerView(row);
  }

  @HttpCode(HttpStatus.OK)
  @Post('subscriptions/:id/:action')
  async toggle(@CurrentUser() user: RequestUser, @Param('id') id: string, @Param('action') action: string, @Req() req: Request) {
    if (action !== 'start' && action !== 'stop') throw new NotFoundException();
    const sub = await this.prisma.strategyFollower.findFirst({ where: { id, followerUserId: user.id }, include: { brokerAccount: true } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (action === 'start') {
      const a = sub.brokerAccount;
      if (!a) throw new BadRequestException('Select a broker account first');
      if (a.broker !== 'MOCK' && a.status !== 'CONNECTED') throw new BadRequestException('Your broker is not connected — log in to your broker first.');
    }
    const row = await this.prisma.strategyFollower.update({
      where: { id },
      data:
        action === 'start'
          ? { copyStatus: 'ON', startedAt: new Date(), stoppedAt: null, stoppedReason: null }
          : { copyStatus: 'OFF', stoppedAt: new Date(), stoppedReason: 'Stopped by client', stoppedByUserId: user.id },
      include: { strategy: { select: { name: true } } },
    });
    await this.audit.log({ action: action === 'start' ? 'COPY_STARTED' : 'COPY_STOPPED', actorUserId: user.id, targetType: 'StrategyFollower', targetId: id, client: clientInfo(req) });
    return toStrategyFollowerView(row);
  }

  // ------------------------------------------------------------- portfolio

  @Get('portfolio')
  async portfolio(@CurrentUser() user: RequestUser) {
    const [live, paper, copyOrders] = await Promise.all([
      this.trading.liveData(user.id),
      this.prisma.position.findMany({ where: { userId: user.id, isPaper: true }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.copyOrder.findMany({ where: { followerUserId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return {
      paperMode: this.trading.isSimulated({ broker: 'ZERODHA', isPaper: false }),
      live,
      paperPositions: paper.map((p) => ({ ...p, averagePrice: p.averagePrice.toString(), lastPrice: p.lastPrice?.toString() ?? null, realizedPnl: p.realizedPnl.toString(), unrealizedPnl: p.unrealizedPnl.toString() })),
      copyOrders: copyOrders.map(toCopyOrderView),
    };
  }
}
