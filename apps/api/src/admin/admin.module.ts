import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [HealthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
