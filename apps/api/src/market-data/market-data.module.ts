import { Module } from '@nestjs/common';
import { BrokersModule } from '../brokers/brokers.module';
import { InstrumentsService } from './instruments.service';
import { MarketDataController } from './market-data.controller';
import { MarketFeedService } from './market-feed.service';
import { PriceCacheService } from './price-cache.service';

@Module({
  imports: [BrokersModule],
  controllers: [MarketDataController],
  providers: [PriceCacheService, InstrumentsService, MarketFeedService],
  exports: [PriceCacheService, InstrumentsService, MarketFeedService],
})
export class MarketDataModule {}
