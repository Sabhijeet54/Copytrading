import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type AccountEventType = 'connected' | 'disconnected' | 'expired' | 'settings';

export interface AccountEvent {
  type: AccountEventType;
  brokerAccountId: string;
  userId: string;
}

/**
 * In-process bus for broker-account lifecycle changes. The client registry (order fast path) and the
 * master market feed subscribe to it so their in-memory state never lags the database.
 */
@Injectable()
export class AccountEvents {
  readonly events$ = new Subject<AccountEvent>();
  emit(e: AccountEvent): void {
    this.events$.next(e);
  }
}
