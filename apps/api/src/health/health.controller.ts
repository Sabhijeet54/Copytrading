import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { HealthResponse } from '@ctp/types';
import { Public } from '../common/decorators/auth.decorators';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Liveness/readiness. HTTP 200 while the API can serve requests (database + Redis reachable);
   * a missing worker is reported as "degraded" but does not fail the API's own health check.
   */
  @Public()
  @SkipThrottle()
  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.database !== 'connected' || result.redis !== 'connected') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
