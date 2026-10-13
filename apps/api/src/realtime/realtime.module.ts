import { Global, Module } from '@nestjs/common';
import { AccountEvents } from './account-events';
import { NotifyService } from './notify.service';
import { RealtimeGateway, RealtimeService } from './realtime.gateway';

@Global()
@Module({
  providers: [RealtimeGateway, RealtimeService, NotifyService, AccountEvents],
  exports: [RealtimeService, NotifyService, AccountEvents],
})
export class RealtimeModule {}
