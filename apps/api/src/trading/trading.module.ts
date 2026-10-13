import { Module } from '@nestjs/common';
import { BrokersModule } from '../brokers/brokers.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { ClientRegistryService } from './client-registry.service';
import { CopyEngineService } from './copy-engine.service';
import { FollowerController } from './follower.controller';
import { MasterPollerService } from './master-poller.service';
import { MasterController } from './master.controller';
import { RiskService } from './risk.service';
import { TradingService } from './trading.service';

@Module({
  imports: [BrokersModule, MarketDataModule],
  controllers: [MasterController, FollowerController],
  providers: [TradingService, ClientRegistryService, CopyEngineService, MasterPollerService, RiskService],
  exports: [CopyEngineService, RiskService, ClientRegistryService],
})
export class TradingModule {}
