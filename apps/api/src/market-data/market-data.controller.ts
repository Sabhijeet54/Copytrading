import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength } from 'class-validator';
import type { MarketFeedStatus } from '@ctp/types';
import { Roles } from '../common/decorators/auth.decorators';
import { MarketFeedService } from './market-feed.service';
import { PriceCacheService } from './price-cache.service';

export class FeedInstrumentsDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(60, { each: true }) instruments!: string[];
}
export class FeedBrokerDto {
  @IsIn(['ZERODHA', 'ANGEL_ONE']) broker!: 'ZERODHA' | 'ANGEL_ONE';
}

/** Master live market data: feed status/control and cached LTPs (no broker quote calls). */
@Controller('market')
export class MarketDataController {
  constructor(
    private readonly feed: MarketFeedService,
    private readonly prices: PriceCacheService,
  ) {}

  @Roles('MASTER', 'ADMIN')
  @Get('feed/status')
  status(): MarketFeedStatus {
    return this.feed.status();
  }

  @Roles('MASTER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('feed/restart')
  restart(): Promise<MarketFeedStatus> {
    return this.feed.restart();
  }

  @Roles('MASTER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('feed/broker')
  broker(@Body() dto: FeedBrokerDto): Promise<MarketFeedStatus> {
    return this.feed.setPreferredBroker(dto.broker);
  }

  @Roles('MASTER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('feed/subscribe')
  async subscribe(@Body() dto: FeedInstrumentsDto): Promise<MarketFeedStatus> {
    await this.feed.subscribe(dto.instruments);
    return this.feed.status();
  }

  @Roles('MASTER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('feed/unsubscribe')
  async unsubscribe(@Body() dto: FeedInstrumentsDto): Promise<MarketFeedStatus> {
    await this.feed.unsubscribe(dto.instruments);
    return this.feed.status();
  }

  /** GET /market/ltp?i=NSE:INFY&i=NFO:NIFTY24OCT25000CE — from the in-memory cache. */
  @Get('ltp')
  ltp(@Query('i') i?: string | string[]) {
    const keys = (Array.isArray(i) ? i : i ? [i] : []).slice(0, 200).map((k) => k.toUpperCase());
    return this.prices.snapshot(keys);
  }
}
