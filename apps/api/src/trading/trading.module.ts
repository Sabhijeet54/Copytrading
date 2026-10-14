import { Module } from '@nestjs/common';
import { BrokersModule } from '../brokers/brokers.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { ClientRegistryService } from './client-registry.service';
import { CopyEngineService } from './copy-engine.service';
import { CopyReconcilerService } from './copy-reconciler.service';
import { ClientAssignService } from './client-assign.service';
import { FollowerController } from './follower.controller';
import { MasterPollerService } from './master-poller.service';
import { OrderMirrorService } from './order-mirror.service';
import { MasterController } from './master.controller';
import { RiskService } from './risk.service';
import { TradingService } from './trading.service';

@Module({
  imports: [BrokersModule, MarketDataModule],
  controllers: [MasterController, FollowerController],
  providers: [ClientAssignService, TradingService, ClientRegistryService, CopyEngineService, CopyReconcilerService, OrderMirrorService, MasterPollerService, RiskService],
  exports: [ClientAssignService, CopyEngineService, CopyReconcilerService, RiskService, ClientRegistryService],
})
export class TradingModule {}
