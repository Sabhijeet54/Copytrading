import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  IsBoolean,
} from 'class-validator';

const EXCHANGES = ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS', 'BCD'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class StrategyDto {
  @Transform(trim) @IsString() @Length(2, 100) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(EXCHANGES, { each: true }) allowedExchanges?: (typeof EXCHANGES)[number][];
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(40, { each: true }) allowedInstruments?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxFollowers?: number;
  @Type(() => Number) @IsNumber() @Min(0) masterCapital!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxOrderValue?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxQuantityPerOrder?: number;
}

export class StrategyStatusDto {
  @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED']) status!: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

export class MasterOrderDto {
  @IsString() strategyId!: string;
  @IsOptional() @IsString() brokerAccountId?: string;
  @IsIn(EXCHANGES) exchange!: (typeof EXCHANGES)[number];
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9&_\-]{1,40}$/, { message: 'Invalid symbol' })
  symbol!: string;
  @IsIn(['BUY', 'SELL']) side!: 'BUY' | 'SELL';
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  @IsIn(['MARKET', 'LIMIT', 'SL', 'SL_M']) orderType!: 'MARKET' | 'LIMIT' | 'SL' | 'SL_M';
  @IsIn(['DELIVERY', 'INTRADAY', 'CARRY_FORWARD']) productType!: 'DELIVERY' | 'INTRADAY' | 'CARRY_FORWARD';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) triggerPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) lotSize?: number;
}

export class AssignClientDto {
  @Transform(trim) @IsString() @Length(3, 200) email!: string;
  @IsOptional() @IsString() brokerAccountId?: string;
  @IsOptional() @IsEnum({ FIXED_QUANTITY: 'FIXED_QUANTITY', CAPITAL_PERCENTAGE: 'CAPITAL_PERCENTAGE', PROPORTIONAL: 'PROPORTIONAL' })
  allocationMode?: 'FIXED_QUANTITY' | 'CAPITAL_PERCENTAGE' | 'PROPORTIONAL';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) allocationAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(1000) allocationPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) fixedQuantity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) fixedLots?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxLots?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxQuantity?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxTradeValue?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxDailyLoss?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxTradesPerDay?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(['EQ', 'FO'], { each: true }) allowedSegments?: ('EQ' | 'FO')[];
  @IsOptional() @IsBoolean() startCopy?: boolean;
}

export class ExitPositionDto {
  @IsString() accountId!: string;
  @IsIn(EXCHANGES) exchange!: (typeof EXCHANGES)[number];
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9&_\-]{1,40}$/, { message: 'Invalid symbol' })
  symbol!: string;
  @IsIn(['DELIVERY', 'INTRADAY', 'CARRY_FORWARD']) productType!: 'DELIVERY' | 'INTRADAY' | 'CARRY_FORWARD';
}

export class FollowDto {
  @IsString() brokerAccountId!: string;
  @IsEnum({ FIXED_QUANTITY: 'FIXED_QUANTITY', CAPITAL_PERCENTAGE: 'CAPITAL_PERCENTAGE', PROPORTIONAL: 'PROPORTIONAL' })
  allocationMode!: 'FIXED_QUANTITY' | 'CAPITAL_PERCENTAGE' | 'PROPORTIONAL';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) allocationAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(1000) allocationPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) fixedQuantity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxQuantity?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxTradeValue?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) fixedLots?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxLots?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxDailyLoss?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxTradesPerDay?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(['EQ', 'FO'], { each: true }) allowedSegments?: ('EQ' | 'FO')[];
}
