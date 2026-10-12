import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientInfo } from '../common/client-info';
import { CurrentUser, RequestUser, Roles } from '../common/decorators/auth.decorators';
import { AdminService } from './admin.service';
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
  constructor(private readonly admin: AdminService) {}

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
