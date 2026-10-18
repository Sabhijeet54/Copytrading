import { Logger } from '@nestjs/common';

/**
 * Shared, lazily loaded instrument master for one broker (Dhan / Fyers / Kotak Neo / 5paisa). Each broker
 * names contracts its own way (security id, fyToken, scrip code…); the loader turns its public file into
 * rows keyed by the platform's canonical symbol, so adapters can map both ways. Loaded once per IST day per
 * file and shared by every adapter instance (module singleton, no DI).
 */
export interface BrokerInstrument {
  /** Platform exchange code (NSE, BSE, NFO, BFO, MCX, CDS, BCD). */
  exchange: string;
  /** Canonical platform symbol (see trading/symbols.ts). */
  symbol: string;
  /** The broker's own id for the contract (security id / scrip code / fyers ticker…). */
  key: string;
  lotSize: number;
  /** Broker trading symbol, when orders need it next to the key. */
  tradingSymbol?: string;
}

const istDay = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export class BrokerInstrumentStore {
  private readonly logger: Logger;
  private readonly day = new Map<string, string>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly byCanonical = new Map<string, BrokerInstrument>();
  private readonly byKey = new Map<string, BrokerInstrument>();

  constructor(
    name: string,
    /** Platform exchange → the file that holds it (undefined = not supported). */
    private readonly fileOf: (exchange: string) => string | undefined,
    /** Downloads and parses one file. `ctx` carries per-session data some brokers need (e.g. Kotak base URL). */
    private readonly loader: (file: string, ctx?: Record<string, string | undefined>) => Promise<BrokerInstrument[]>,
  ) {
    this.logger = new Logger(`${name}Instruments`);
  }

  async ensure(exchange: string, ctx?: Record<string, string | undefined>): Promise<void> {
    const file = this.fileOf(exchange.toUpperCase());
    if (!file || this.day.get(file) === istDay()) return;
    let p = this.loading.get(file);
    if (!p) {
      p = this.load(file, ctx).finally(() => this.loading.delete(file));
      this.loading.set(file, p);
    }
    return p;
  }

  get(exchange: string, canonical: string): BrokerInstrument | undefined {
    return this.byCanonical.get(`${exchange.toUpperCase()}:${canonical.toUpperCase()}`);
  }

  /** `key` is scoped by exchange because some brokers reuse ids across segments. */
  fromKey(exchange: string, key: string): BrokerInstrument | undefined {
    return this.byKey.get(`${exchange.toUpperCase()}|${key}`);
  }

  /** Any exchange, when the broker key is globally unique (e.g. a Fyers ticker). */
  fromAnyKey(key: string): BrokerInstrument | undefined {
    return this.byKey.get(`*|${key}`);
  }

  private async load(file: string, ctx?: Record<string, string | undefined>): Promise<void> {
    try {
      const rows = await this.loader(file, ctx);
      if (!rows.length) throw new Error('empty instrument file');
      for (const r of rows) {
        const ck = `${r.exchange}:${r.symbol}`;
        if (!this.byCanonical.has(ck)) this.byCanonical.set(ck, r);
        this.byKey.set(`${r.exchange}|${r.key}`, r);
        this.byKey.set(`*|${r.key}`, r);
      }
      this.day.set(file, istDay());
      this.logger.log(`Loaded ${rows.length} ${file} instruments`);
    } catch (err) {
      this.logger.warn(`${file} instrument file failed: ${(err as Error).message}`);
      throw err;
    }
  }
}

/** Minimal CSV parser (RFC 4180 quotes, CRLF), returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

/** Header → column index, matching names case-insensitively and ignoring spaces / ';'. */
export function headerIndex(header: string[]): (...names: string[]) => number {
  const norm = (s: string) => s.replace(/[\s;]/g, '').toUpperCase();
  const map = new Map(header.map((h, i) => [norm(h), i]));
  return (...names) => {
    for (const n of names) {
      const i = map.get(norm(n));
      if (i !== undefined) return i;
    }
    return -1;
  };
}

/** IST calendar date (YYYY-MM-DD) of an epoch in seconds or milliseconds. */
export function istDateOfEpoch(v: number): string {
  const ms = v > 1e12 ? v : v * 1000;
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}
