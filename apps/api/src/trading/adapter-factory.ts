import type { BrokerAccount, BrokerName } from '@ctp/database';
import { BrokerApiError } from '../brokers/broker-http';
import type { ApiConfig } from '../config/config.module';
import { AngelOneAdapter, ANGEL_API_ROOT } from './angel.adapter';
import type { BrokerAdapter } from './broker-adapter';
import { KITE_API_ROOT, ZerodhaAdapter } from './zerodha.adapter';

/**
 * Broker adapter registry. To add a broker (Upstox / Dhan / Fyers):
 *   1. add it to the BrokerName enum (Prisma + @ctp/types),
 *   2. implement BrokerAdapter in trading/<broker>.adapter.ts (call assertCanTrade() first in placeOrder),
 *   3. add a login flow in brokers/ and register a factory here.
 * Nothing in the copy engine changes.
 */
export interface AdapterFactory {
  /** REST origin used to keep pooled connections warm. */
  origin: string;
  proxyUrl?: (c: ApiConfig) => string | undefined;
  create(c: ApiConfig, token: string, account: Pick<BrokerAccount, 'mode'>): BrokerAdapter;
}

export const ADAPTERS: Partial<Record<BrokerName, AdapterFactory>> = {
  ZERODHA: {
    origin: KITE_API_ROOT,
    proxyUrl: (c) => c.ZERODHA_PROXY_URL,
    create: (c, token, a) => {
      if (!c.ZERODHA_API_KEY) throw new BrokerApiError('Zerodha is not configured on the server.');
      return new ZerodhaAdapter(c.ZERODHA_API_KEY, token, c.ZERODHA_PROXY_URL, { dataOnly: a.mode === 'DATA_ONLY' });
    },
  },
  ANGEL_ONE: {
    origin: ANGEL_API_ROOT,
    proxyUrl: (c) => c.ANGEL_PROXY_URL,
    create: (c, token, a) => {
      if (!c.ANGEL_API_KEY) throw new BrokerApiError('Angel One is not configured on the server.');
      return new AngelOneAdapter(
        { apiKey: c.ANGEL_API_KEY, publicIp: c.ANGEL_PUBLIC_IP, localIp: c.ANGEL_LOCAL_IP, macAddress: c.ANGEL_MAC_ADDRESS, proxyUrl: c.ANGEL_PROXY_URL },
        token,
        { dataOnly: a.mode === 'DATA_ONLY' },
      );
    },
  },
};
