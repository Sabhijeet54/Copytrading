import { Inject, Injectable } from '@nestjs/common';
import type { BrokerAccount, PrismaClient } from '@ctp/database';
import { PRISMA } from '../common/prisma/prisma.service';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { BrokerApiError } from '../brokers/broker-http';
import { BrokerSessionService } from '../brokers/broker-session.service';
import { ADAPTERS } from './adapter-factory';
import { OrderBlockedError, type BrokerAdapter, type BrokerFunds, type BrokerHolding, type BrokerOrder, type BrokerPosition } from './broker-adapter';

export interface LiveAccountData {
  accountId: string;
  broker: string;
  brokerClientId: string | null;
  isPaper: boolean;
  error?: string;
  funds?: BrokerFunds;
  positions?: BrokerPosition[];
  holdings?: BrokerHolding[];
  orders?: Omit<BrokerOrder, 'raw'>[];
}

/** Builds broker adapters from stored (encrypted) sessions and reads live account data. */
@Injectable()
export class TradingService {

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly sessions: BrokerSessionService,
  ) {}

  /** True when this account must never receive a real order. */
  isSimulated(account: Pick<BrokerAccount, 'broker' | 'isPaper'>): boolean {
    return this.config.PAPER_MODE || account.isPaper || account.broker === 'MOCK';
  }

  /** Hard guard used before every order: DATA_ONLY (master) accounts can never place orders. */
  assertOrderAllowed(account: Pick<BrokerAccount, 'mode' | 'id'>): void {
    if (account.mode === 'DATA_ONLY') throw new OrderBlockedError();
  }

  /** Builds an adapter from an already-decrypted token (no DB access). */
  buildAdapter(account: Pick<BrokerAccount, 'broker' | 'mode'>, token: string): BrokerAdapter {
    const f = ADAPTERS[account.broker];
    if (!f) throw new BrokerApiError(`${account.broker} has no live broker adapter.`);
    return f.create(this.config, token, account);
  }

  /** Throws when the account cannot be used for a real broker call (not connected / token expired). */
  async adapterFor(account: BrokerAccount): Promise<BrokerAdapter> {
    if (account.broker === 'MOCK') throw new BrokerApiError('Paper (MOCK) accounts have no broker connection.');
    if (account.status !== 'CONNECTED') throw new BrokerApiError(`${account.broker} account is not connected. Please log in again.`);
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) {
      await this.sessions.markExpired(account, 'Daily broker token expired — please reconnect.').catch(() => undefined);
      throw new BrokerApiError(`${account.broker} session expired. Please log in again.`);
    }
    const token = await this.sessions.decryptAccess(account);
    if (!token) throw new BrokerApiError('No broker session stored. Please log in again.');
    return this.buildAdapter(account, token);
  }

  /** True when a broker error means the session is no longer valid. */
  isSessionError(err: unknown): boolean {
    if (!(err instanceof BrokerApiError)) return false;
    const msg = err.message;
    // Angel One returns HTTP 403 for rate limits ("exceeding access rate") and static-IP / WAF blocks too —
    // those are transient and must NOT disconnect the account. Only explicit session error codes count.
    if (err.brokerCode === 'RATE_LIMIT' || /access rate|rate limit|too many|static ip|not allowed from this ip/i.test(msg)) return false;
    if (err.brokerCode && /^(AG8001|AG8002|AG8003|AB1010|AB8050|AB8051)$/i.test(err.brokerCode)) return true; // Angel
    if (err.brokerCode === 'TokenException') return true; // Zerodha
    return /invalid token|token expired|invalid jwt|invalid session|session expired|incorrect `api_key` or `access_token`/i.test(msg);
  }

  /** Marks the account EXPIRED (and notifies the owner) when the broker says the session is invalid. */
  async handleBrokerError(account: BrokerAccount, err: unknown): Promise<string> {
    const msg = err instanceof Error ? err.message : 'Broker error';
    if (this.isSessionError(err)) {
      // Angel One: recover with the refresh token before giving up on the session.
      const full = account.status ? account : await this.prisma.brokerAccount.findUnique({ where: { id: account.id } });
      if (full && (await this.sessions.renewAngelSession(full))) return `${msg} (session renewed — retrying)`;
      await this.sessions.markExpired(account, `Broker rejected the session: ${msg}`).catch(() => undefined);
    }
    return msg;
  }

  /** Funds, positions, holdings and today's orders for every connected real account of a user. */
  async liveData(userId: string): Promise<LiveAccountData[]> {
    const accounts = await this.prisma.brokerAccount.findMany({ where: { userId, broker: { not: 'MOCK' } }, orderBy: { createdAt: 'asc' } });
    return Promise.all(
      accounts.map(async (a): Promise<LiveAccountData> => {
        const base = { accountId: a.id, broker: a.broker, brokerClientId: a.brokerClientId, isPaper: a.isPaper };
        try {
          const ad = await this.adapterFor(a);
          const [funds, positions, holdings, orders] = await Promise.all([
            ad.funds().catch(() => undefined),
            ad.positions(),
            ad.holdings().catch(() => []),
            ad.orders(),
          ]);
          return { ...base, funds, positions, holdings, orders: orders.map(({ raw: _raw, ...o }) => o) };
        } catch (err) {
          return { ...base, error: await this.handleBrokerError(a, err) };
        }
      }),
    );
  }
}
