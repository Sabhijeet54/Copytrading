import { Inject, Injectable, Logger } from '@nestjs/common';
import { fetch as undiciFetch } from 'undici';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { instrumentKey } from './price-cache.service';

export interface KiteInstrument {
  token: number;
  exchange: string;
  symbol: string;
  lotSize: number;
  tickSize: number;
}

const istDay = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Kite instrument master (per exchange CSV from api.kite.trade/instruments/<EX>), loaded once per IST day
 * and kept in memory: symbol ⇄ instrument_token for the ticker, and lot size for copy quantities.
 */
@Injectable()
export class InstrumentsService {
  private readonly logger = new Logger('Instruments');
  private readonly byKey = new Map<string, KiteInstrument>();
  private readonly byToken = new Map<number, KiteInstrument>();
  private readonly loaded = new Map<string, string>(); // exchange -> IST day
  private readonly loading = new Map<string, Promise<void>>();

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  /** Synchronous lookups (memory only). */
  get(exchange: string, symbol: string): KiteInstrument | undefined {
    return this.byKey.get(instrumentKey(exchange, symbol));
  }
  byInstrumentToken(token: number): KiteInstrument | undefined {
    return this.byToken.get(token);
  }
  lotSize(exchange: string, symbol: string): number | undefined {
    return this.get(exchange, symbol)?.lotSize;
  }

  async ensureExchange(exchange: string, accessToken?: string): Promise<void> {
    const ex = exchange.toUpperCase();
    if (this.loaded.get(ex) === istDay()) return;
    let p = this.loading.get(ex);
    if (!p) {
      p = this.load(ex, accessToken).finally(() => this.loading.delete(ex));
      this.loading.set(ex, p);
    }
    return p;
  }

  private async load(exchange: string, accessToken?: string): Promise<void> {
    try {
      const headers: Record<string, string> = { 'X-Kite-Version': '3' };
      if (accessToken && this.config.ZERODHA_API_KEY) headers.Authorization = `token ${this.config.ZERODHA_API_KEY}:${accessToken}`;
      const res = await undiciFetch(`https://api.kite.trade/instruments/${exchange}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split('\n');
      const head = lines[0]!.split(',');
      const col = (n: string) => head.indexOf(n);
      const iTok = col('instrument_token'), iSym = col('tradingsymbol'), iLot = col('lot_size'), iTick = col('tick_size'), iEx = col('exchange');
      let n = 0;
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i]!.split(',');
        if (c.length < head.length) continue;
        const inst: KiteInstrument = {
          token: Number(c[iTok]),
          exchange: (c[iEx] || exchange).toUpperCase(),
          symbol: c[iSym]!.replace(/"/g, '').toUpperCase(),
          lotSize: Number(c[iLot]) || 1,
          tickSize: Number(c[iTick]) || 0.05,
        };
        if (!inst.token) continue;
        this.byKey.set(instrumentKey(inst.exchange, inst.symbol), inst);
        this.byToken.set(inst.token, inst);
        n++;
      }
      this.loaded.set(exchange, istDay());
      this.logger.log(`Loaded ${n} ${exchange} instruments`);
    } catch (err) {
      this.logger.warn(`Instrument load for ${exchange} failed: ${(err as Error).message}`);
    }
  }
}
