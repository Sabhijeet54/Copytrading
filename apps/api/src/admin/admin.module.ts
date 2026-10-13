import { Module } from '@nestjs/common';
import { BrokersModule } from '../brokers/brokers.module';
import { HealthModule } from '../health/health.module';
import { TradingModule } from '../trading/trading.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [HealthModule, BrokersModule, TradingModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
