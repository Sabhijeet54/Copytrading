import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { BrokerSessionService } from './broker-session.service';

/**
 * Detects daily broker token expiry (Zerodha ~06:00 IST, Angel One midnight IST): CONNECTED accounts whose
 * tokenExpiresAt has passed become EXPIRED, are evicted from the order cache / live feed and the owner is
 * notified so the UI can show "Reconnect".
 */
@Injectable()
export class TokenExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TokenExpiry');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly sessions: BrokerSessionService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.config.TOKEN_EXPIRY_CHECK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const expired = await this.sessions.expireDue();
      if (expired.length) this.logger.log(`Marked ${expired.length} broker account(s) EXPIRED`);
    } catch (err) {
      this.logger.warn(`Expiry sweep failed: ${(err as Error).message}`);
    }
  }
}
