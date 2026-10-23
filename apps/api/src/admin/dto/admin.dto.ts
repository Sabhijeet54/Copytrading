import { StrategyDto } from '../../trading/trading.dto';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../../auth/dto/auth.dto';
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
  @IsOptional() @IsIn(['NONE', 'ACTIVE', 'EXPIRING', 'EXPIRED']) licence?: 'NONE' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED';
}

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const ROLES = ['ADMIN', 'SUB_ADMIN', 'MASTER', 'FOLLOWER'] as const;

export class CreateUserDto {
  @Transform(trim) @IsString() @Length(2, 100) name!: string;
  @Transform(lower) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @Transform(trim) @Matches(/^[0-9+\-\s]{7,20}$/, { message: 'Invalid mobile number' }) mobile?: string;
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }) password!: string;
  @IsIn(ROLES) role!: (typeof ROLES)[number];
  /** Optional licence to assign right away. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) licenceDays?: number;
}

export class UpdateUserDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 100) name?: string;
  @IsOptional() @Transform(trim) @Matches(/^[0-9+\-\s]{7,20}$/, { message: 'Invalid mobile number' }) mobile?: string;
  @IsOptional() @IsIn(ROLES) role?: (typeof ROLES)[number];
}

export class AssignLicenceDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(3650) days!: number;
  /** true (default): add the days to a licence that is still running; false: start fresh from today. */
  @IsOptional() @IsBoolean() extend?: boolean;
}

export class AdminSignalsQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(400) strategyIds?: string;
  @IsOptional() @IsIn(['all', 'open', 'closed']) status?: 'all' | 'open' | 'closed';
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

export class AdminStrategyMasterDto {
  @IsString() masterUserId!: string;
}

export class AdminCreateStrategyDto extends StrategyDto {
  @IsString() masterUserId!: string;
}

export class MasterSubAdminDto {
  @Transform(trim) @IsString() @Length(2, 100) name!: string;
  @Transform(lower) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @Transform(trim) @Matches(/^[0-9+\-\s]{7,20}$/, { message: 'Invalid mobile number' }) mobile?: string;
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }) password!: string;
}
