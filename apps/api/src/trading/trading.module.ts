import { Module } from '@nestjs/common';
import { BrokersModule } from '../brokers/brokers.module';
import { CopyEngineService } from './copy-engine.service';
import { FollowerController } from './follower.controller';
import { MasterPollerService } from './master-poller.service';
import { MasterController } from './master.controller';
import { TradingService } from './trading.service';

@Module({
  imports: [BrokersModule],
  controllers: [MasterController, FollowerController],
  providers: [TradingService, CopyEngineService, MasterPollerService],
})
export class TradingModule {}
