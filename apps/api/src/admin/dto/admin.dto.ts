import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import {
  AuditAction,
  BrokerAccountStatus,
  BrokerName,
  OrderStatus,
  Role,
  StrategyStatus,
  SystemEventSeverity,
  UserStatus,
} from '@ctp/database';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AdminUsersQueryDto extends PaginationQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsEnum(BrokerName) broker?: BrokerName;
}

export class AdminBrokerAccountsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(BrokerName) broker?: BrokerName;
  @IsOptional() @IsEnum(BrokerAccountStatus) status?: BrokerAccountStatus;
  @IsOptional() @IsString() @MaxLength(40) userId?: string;
}

export class AdminStrategiesQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(StrategyStatus) status?: StrategyStatus;
  @IsOptional() @IsString() @MaxLength(40) masterUserId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
}

class DateRangeQueryDto extends PaginationQueryDto {
  /** Inclusive lower bound (ISO date or datetime). */
  @IsOptional() @IsDateString() from?: string;
  /** Exclusive upper bound (ISO date or datetime). */
  @IsOptional() @IsDateString() to?: string;
}

export class AdminMasterTradesQueryDto extends DateRangeQueryDto {
  @IsOptional() @IsEnum(BrokerName) broker?: BrokerName;
  @IsOptional() @IsString() @MaxLength(40) userId?: string;
  @IsOptional() @IsString() @MaxLength(40) strategyId?: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) symbol?: string;
}

export class AdminCopyOrdersQueryDto extends DateRangeQueryDto {
  @IsOptional() @IsEnum(BrokerName) broker?: BrokerName;
  @IsOptional() @IsString() @MaxLength(40) userId?: string;
  @IsOptional() @IsString() @MaxLength(40) strategyId?: string;
  @IsOptional() @IsString() @MaxLength(40) masterTradeId?: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
}

export class AdminPositionsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(40) userId?: string;
  @IsOptional() @IsEnum(BrokerName) broker?: BrokerName;
  @IsOptional() @IsIn(['open', 'all']) scope?: 'open' | 'all';
}

export class AdminAuditLogsQueryDto extends DateRangeQueryDto {
  @IsOptional() @IsEnum(AuditAction) action?: AuditAction;
  @IsOptional() @IsString() @MaxLength(40) userId?: string;
}

export class AdminSystemEventsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(SystemEventSeverity) severity?: SystemEventSeverity;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus) status!: UserStatus;

  @IsOptional() @Transform(trim) @IsString() @Length(3, 500) reason?: string;
}

export class ReasonDto {
  @Transform(trim) @IsString() @Length(3, 500) reason!: string;
}
