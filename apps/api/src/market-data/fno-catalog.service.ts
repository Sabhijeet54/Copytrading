import { Injectable, Logger } from '@nestjs/common';
import { fetch as undiciFetch } from 'undici';

/** One expiry of one underlying. */
interface ExpiryInfo {
  lotSize: number;
  strikes: Set<number>;
  hasFut: boolean;
  hasOpt: boolean;
}
type Book = Map<string, Map<string, ExpiryInfo>>; // underlying name → expiry (YYYY-MM-DD) → info

export const FNO_EXCHANGES = ['NFO', 'BFO', 'MCX'] as const;
export type FnoExchange = (typeof FNO_EXCHANGES)[number];

const istDay = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const MON: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const ANGEL_SCRIP_MASTER = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

/**
 * Full F&O contract list (index + stock options / futures, MCX) for the master's order form: every
 * underlying, its live expiries (weekly + monthly), strikes and lot size. Nothing is hard-coded — the list
 * comes from the broker instrument masters and is refreshed once per IST day:
 *   1. Zerodha (Kite) instrument dump per exchange (public CSV), else
 *   2. Angel One OpenAPI scrip master (public JSON, all exchanges in one file).
 */
@Injectable()
export class FnoCatalogService {
  private readonly logger = new Logger('FnoCatalog');
  private readonly books = new Map<string, Book>();
  private readonly loadedDay = new Map<string, string>();
  private loading = new Map<string, Promise<void>>();
  private angelDay: string | null = null;
  private angelLoading?: Promise<void>;

  /** Underlyings matching `q` (prefix first), with lot size and nearest expiry. */
  async scripts(exchange: FnoExchange, q: string, limit = 50) {
    const book = await this.book(exchange);
    const term = q.trim().toUpperCase();
    const today = istDay();
    const out: { name: string; lotSize: number; nearestExpiry: string | null }[] = [];
    for (const [name, exp] of book) {
      if (term && !name.includes(term)) continue;
      const live = [...exp.keys()].filter((d) => d >= today).sort();
      if (!live.length) continue;
      out.push({ name, lotSize: exp.get(live[0]!)!.lotSize, nearestExpiry: live[0]! });
    }
    out.sort((a, b) => Number(!a.name.startsWith(term)) - Number(!b.name.startsWith(term)) || a.name.localeCompare(b.name));
    return out.slice(0, limit);
  }

  /** Live expiries (nearest first) of one underlying, with lot size and strikes; `kind` filters options / futures. */
  async chain(exchange: FnoExchange, name: string, kind: 'OPT' | 'FUT') {
    const book = await this.book(exchange);
    const exp = book.get(name.trim().toUpperCase());
    if (!exp) return { name: name.toUpperCase(), lotSize: null, expiries: [] };
    const today = istDay();
    const dates = [...exp.keys()].filter((d) => d >= today && (kind === 'FUT' ? exp.get(d)!.hasFut : exp.get(d)!.hasOpt)).sort();
    // Monthly = last expiry of its calendar month (among all expiries of this underlying).
    const all = [...exp.keys()].sort();
    const lastOfMonth = new Set<string>();
    for (const d of all) {
      const m = d.slice(0, 7);
      const later = all.filter((x) => x.startsWith(m));
      lastOfMonth.add(later[later.length - 1]!);
    }
    const expiries = dates.map((d) => {
      const e = exp.get(d)!;
      return { date: d, lotSize: e.lotSize, monthly: lastOfMonth.has(d), strikes: kind === 'OPT' ? [...e.strikes].sort((a, b) => a - b) : [] };
    });
    return { name: name.toUpperCase(), lotSize: expiries[0]?.lotSize ?? null, expiries };
  }

  // ------------------------------------------------------------ loading

  private async book(exchange: FnoExchange): Promise<Book> {
    if (this.loadedDay.get(exchange) !== istDay()) {
      let p = this.loading.get(exchange);
      if (!p) {
        p = this.load(exchange).finally(() => this.loading.delete(exchange));
        this.loading.set(exchange, p);
      }
      await p;
    }
    return this.books.get(exchange) ?? new Map();
  }

  private async load(exchange: FnoExchange): Promise<void> {
    try {
      await this.loadKite(exchange);
    } catch (err) {
      this.logger.warn(`Kite ${exchange} list failed (${(err as Error).message}) — trying Angel One scrip master`);
      try {
        await this.loadAngel();
      } catch (e) {
        this.logger.error(`Angel One scrip master failed: ${(e as Error).message}`);
      }
    }
  }

  private add(book: Book, name: string, expiry: string, type: string, strike: number, lotSize: number) {
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return;
    const exp = book.get(name) ?? new Map<string, ExpiryInfo>();
    const e = exp.get(expiry) ?? { lotSize, strikes: new Set<number>(), hasFut: false, hasOpt: false };
    if (type === 'FUT') e.hasFut = true;
    else if (strike > 0) {
      e.hasOpt = true;
      e.strikes.add(strike);
    }
    e.lotSize = lotSize || e.lotSize;
    exp.set(expiry, e);
    book.set(name, exp);
  }

  private async loadKite(exchange: FnoExchange): Promise<void> {
    const res = await undiciFetch(`https://api.kite.trade/instruments/${exchange}`, { headers: { 'X-Kite-Version': '3' }, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lines = (await res.text()).split('\n');
    const head = lines[0]!.split(',');
    const col = (n: string) => head.indexOf(n);
    const iName = col('name'), iExp = col('expiry'), iStrike = col('strike'), iType = col('instrument_type'), iLot = col('lot_size');
    if (iName < 0 || iExp < 0 || iType < 0) throw new Error('unexpected CSV header');
    const book: Book = new Map();
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i]!.split(',');
      if (c.length < head.length) continue;
      const type = (c[iType] ?? '').replace(/"/g, '');
      if (type !== 'CE' && type !== 'PE' && type !== 'FUT') continue;
      this.add(book, (c[iName] ?? '').replace(/"/g, '').trim().toUpperCase(), (c[iExp] ?? '').slice(0, 10), type, Number(c[iStrike]) || 0, Number(c[iLot]) || 1);
    }
    if (!book.size) throw new Error('empty list');
    this.books.set(exchange, book);
    this.loadedDay.set(exchange, istDay());
    this.logger.log(`Loaded ${book.size} ${exchange} underlyings (Zerodha list)`);
  }

  /** One JSON for every exchange; fills all F&O books at once. */
  private async loadAngel(): Promise<void> {
    if (this.angelDay === istDay()) return;
    this.angelLoading ??= (async () => {
      const res = await undiciFetch(ANGEL_SCRIP_MASTER, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { name?: string; expiry?: string; strike?: string; lotsize?: string; instrumenttype?: string; exch_seg?: string }[];
      const books = new Map<string, Book>(FNO_EXCHANGES.map((e) => [e, new Map()]));
      for (const r of rows) {
        const book = books.get(r.exch_seg ?? '');
        if (!book || !r.instrumenttype || !r.expiry) continue;
        const m = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(r.expiry.toUpperCase());
        if (!m || !MON[m[2]!]) continue;
        const expiry = `${m[3]}-${MON[m[2]!]}-${m[1]}`;
        const fut = r.instrumenttype.startsWith('FUT');
        const opt = r.instrumenttype.startsWith('OPT');
        if (!fut && !opt) continue;
        // Angel strikes are in paise (× 100).
        this.add(book, (r.name ?? '').trim().toUpperCase(), expiry, fut ? 'FUT' : 'CE', fut ? 0 : Number(r.strike) / 100, Number(r.lotsize) || 1);
      }
      for (const [ex, book] of books) {
        if (!book.size) continue;
        this.books.set(ex, book);
        this.loadedDay.set(ex, istDay());
        this.logger.log(`Loaded ${book.size} ${ex} underlyings (Angel One scrip master)`);
      }
      this.angelDay = istDay();
    })().finally(() => (this.angelLoading = undefined));
    return this.angelLoading;
  }
}
