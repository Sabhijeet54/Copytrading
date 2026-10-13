import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientInfo } from '../common/client-info';
import { CurrentUser, RequestUser, Roles } from '../common/decorators/auth.decorators';
import { AdminService } from './admin.service';
import { CopyEngineService } from '../trading/copy-engine.service';
import { RiskService } from '../trading/risk.service';
import { PRISMA } from '../common/prisma/prisma.service';
import type { PrismaClient } from '@ctp/database';
import { startOfTradingDayIST } from './admin.service';
import {
  AdminAuditLogsQueryDto,
  AdminBrokerAccountsQueryDto,
  AdminCopyOrdersQueryDto,
  AdminMasterTradesQueryDto,
  AdminPositionsQueryDto,
  AdminStrategiesQueryDto,
  AdminSystemEventsQueryDto,
  AdminUsersQueryDto,
  ReasonDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

/** Every route here requires role ADMIN (enforced by the global RolesGuard). */
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly risk: RiskService,
    private readonly engine: CopyEngineService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /** KILL SWITCH: halt copying, turn every subscription OFF and exit all open client positions. */
  @Post('kill-switch')
  killSwitch(@CurrentUser() me: RequestUser, @Body() dto: ReasonDto) {
    return this.risk.killSwitch(me.id, dto.reason);
  }

  /** Manual square-off of all INTRADAY client positions (same as the auto square-off). */
  @Post('square-off')
  squareOff() {
    return this.risk.squareOffAll({ intradayOnly: true });
  }

  /** Copy order latency: in-memory p50/p95 + today's DB average. */
  @Get('copy-trading/latency')
  async latency() {
    const agg = await this.prisma.copyOrder.aggregate({
      where: { createdAt: { gte: startOfTradingDayIST() }, latencyMs: { not: null }, isPaper: false },
      _avg: { latencyMs: true },
      _count: true,
    });
    return { ...this.engine.latency.snapshot(), dbTodayAvgMs: agg._avg.latencyMs ? Math.round(agg._avg.latencyMs) : null, dbTodayCount: agg._count };
  }

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  // users
  @Get('users')
  users(@Query() q: AdminUsersQueryDto) {
    return this.admin.listUsers(q);
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Patch('users/:id/status')
  setUserStatus(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateUserStatusDto, @Req() req: Request) {
    return this.admin.setUserStatus(me, id, dto, clientInfo(req));
  }

  // broker accounts
  @Get('broker-accounts')
  brokerAccounts(@Query() q: AdminBrokerAccountsQueryDto) {
    return this.admin.listBrokerAccounts(q);
  }

  @Post('broker-accounts/:id/disconnect')
  disconnectBroker(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.disconnectBrokerAccount(me, id, dto.reason, clientInfo(req));
  }

  // strategies & copy control
  @Get('strategies')
  strategies(@Query() q: AdminStrategiesQueryDto) {
    return this.admin.listStrategies(q);
  }

  @Get('strategies/:id/followers')
  strategyFollowers(@Param('id') id: string) {
    return this.admin.listStrategyFollowers(id);
  }

  @Post('strategies/:id/pause')
  pauseStrategy(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.pauseStrategy(me, id, dto.reason, clientInfo(req));
  }

  @Post('strategy-followers/:id/stop')
  stopFollower(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.stopFollowerCopy(me, id, dto.reason, clientInfo(req));
  }

  @Get('copy-trading/status')
  async copyStatus() {
    const halt = await this.admin.copyHaltState();
    return { halted: halt !== null, ...(halt ? { halt } : {}) };
  }

  @Post('copy-trading/halt')
  halt(@CurrentUser() me: RequestUser, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.haltCopyTrading(me, dto.reason, clientInfo(req));
  }

  @Post('copy-trading/resume')
  resume(@CurrentUser() me: RequestUser, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.admin.resumeCopyTrading(me, dto.reason, clientInfo(req));
  }

  // trading data
  @Get('master-trades')
  masterTrades(@Query() q: AdminMasterTradesQueryDto) {
    return this.admin.listMasterTrades(q);
  }

  @Get('copy-orders')
  copyOrders(@Query() q: AdminCopyOrdersQueryDto) {
    return this.admin.listCopyOrders(q);
  }

  @Get('positions')
  positions(@Query() q: AdminPositionsQueryDto) {
    return this.admin.listPositions(q);
  }

  // audit & health
  @Get('audit-logs')
  auditLogs(@Query() q: AdminAuditLogsQueryDto) {
    return this.admin.listAuditLogs(q);
  }

  @Get('system-events')
  systemEvents(@Query() q: AdminSystemEventsQueryDto) {
    return this.admin.listSystemEvents(q);
  }

  @Get('system-health')
  systemHealth() {
    return this.admin.systemHealth();
  }
}
