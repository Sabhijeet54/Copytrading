import { Inject, Injectable } from '@nestjs/common';
import type { BrokerAccount, PrismaClient } from '@ctp/database';
import { PRISMA } from '../common/prisma/prisma.service';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { BrokerApiError } from '../brokers/broker-http';
import { BrokerSessionService } from '../brokers/broker-session.service';
import { AngelOneAdapter } from './angel.adapter';
import type { BrokerAdapter, BrokerFunds, BrokerHolding, BrokerOrder, BrokerPosition } from './broker-adapter';
import { ZerodhaAdapter } from './zerodha.adapter';

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

  /** Throws when the account cannot be used for a real broker call (not connected / token expired). */
  async adapterFor(account: BrokerAccount): Promise<BrokerAdapter> {
    if (account.broker === 'MOCK') throw new BrokerApiError('Paper (MOCK) accounts have no broker connection.');
    if (account.status !== 'CONNECTED') throw new BrokerApiError(`${account.broker} account is not connected. Please log in again.`);
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) {
      await this.prisma.brokerAccount.update({ where: { id: account.id }, data: { status: 'EXPIRED' } }).catch(() => undefined);
      throw new BrokerApiError(`${account.broker} session expired. Please log in again.`);
    }
    const token = await this.sessions.decryptAccess(account);
    if (!token) throw new BrokerApiError('No broker session stored. Please log in again.');
    const c = this.config;
    if (account.broker === 'ZERODHA') {
      if (!c.ZERODHA_API_KEY) throw new BrokerApiError('Zerodha is not configured on the server.');
      return new ZerodhaAdapter(c.ZERODHA_API_KEY, token, c.ZERODHA_PROXY_URL);
    }
    if (!c.ANGEL_API_KEY) throw new BrokerApiError('Angel One is not configured on the server.');
    return new AngelOneAdapter(
      { apiKey: c.ANGEL_API_KEY, publicIp: c.ANGEL_PUBLIC_IP, localIp: c.ANGEL_LOCAL_IP, macAddress: c.ANGEL_MAC_ADDRESS, proxyUrl: c.ANGEL_PROXY_URL },
      token,
    );
  }

  /** Marks the account EXPIRED when the broker says the session is invalid. */
  async handleBrokerError(account: BrokerAccount, err: unknown): Promise<string> {
    const msg = err instanceof Error ? err.message : 'Broker error';
    if (err instanceof BrokerApiError && (err.status === 403 || err.brokerCode === 'TokenException' || /token|session|AG8001|invalid jwt/i.test(msg))) {
      await this.prisma.brokerAccount
        .update({ where: { id: account.id }, data: { status: 'EXPIRED', lastError: msg.slice(0, 500) } })
        .catch(() => undefined);
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
