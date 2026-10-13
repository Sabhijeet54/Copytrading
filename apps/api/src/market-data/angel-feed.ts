import { EventEmitter } from 'node:events';

/** SmartAPI exchangeType codes. */
export const ANGEL_EXCHANGE_TYPE: Record<string, number> = { NSE: 1, NFO: 2, BSE: 3, BFO: 4, MCX: 5, CDS: 13 };

/**
 * Minimal Angel One SmartAPI WebSocket 2.0 (SmartStream) client on Node's built-in WebSocket.
 * Auth via query params (clientCode, feedToken, apiKey). LTP mode (1). Binary frames are little-endian:
 *   [0] mode, [1] exchangeType, [2..27) token (ASCII, NUL padded), [27..35) seq, [35..43) exch ts, [43..51) LTP (paise).
 * A text "ping" is sent every 25 s (server answers "pong").
 * Events: 'open', 'close', 'error', 'tick' (exchangeType, token, ltp), 'message'.
 */
export class AngelFeed extends EventEmitter {
  private ws?: WebSocket;
  private ping?: NodeJS.Timeout;
  private readonly subs = new Map<number, Set<string>>();

  constructor(
    private readonly apiKey: string,
    private readonly clientCode: string,
    private readonly feedToken: string,
  ) {
    super();
  }

  connect(): void {
    const qs = new URLSearchParams({ clientCode: this.clientCode, feedToken: this.feedToken, apiKey: this.apiKey });
    const ws = new WebSocket(`wss://smartapisocket.angelone.in/smart-stream?${qs.toString()}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.emit('open');
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
      for (const [ex, toks] of this.subs) if (toks.size) this.send(1, ex, [...toks]);
    };
    ws.onclose = (e) => {
      if (this.ping) clearInterval(this.ping);
      this.emit('close', `${e.code} ${e.reason || ''}`.trim());
    };
    ws.onerror = () => this.emit('error', new Error('SmartStream socket error'));
    ws.onmessage = (e) => {
      this.emit('message');
      if (typeof e.data === 'string') return; // "pong" / errors
      const buf = e.data as ArrayBuffer;
      if (buf.byteLength < 51) return;
      const v = new DataView(buf);
      const exType = v.getUint8(1);
      let token = '';
      for (let i = 2; i < 27; i++) {
        const c = v.getUint8(i);
        if (c === 0) break;
        token += String.fromCharCode(c);
      }
      const ltp = Number(v.getBigInt64(43, true)) / (exType === 13 ? 10_000_000 : 100);
      this.emit('tick', exType, token, ltp);
    };
  }

  subscribe(exchangeType: number, tokens: string[]): void {
    const set = this.subs.get(exchangeType) ?? new Set<string>();
    const fresh = tokens.filter((t) => !set.has(t));
    fresh.forEach((t) => set.add(t));
    this.subs.set(exchangeType, set);
    if (fresh.length && this.ws?.readyState === WebSocket.OPEN) this.send(1, exchangeType, fresh);
  }

  private send(action: 0 | 1, exchangeType: number, tokens: string[]): void {
    this.ws!.send(JSON.stringify({ correlationID: 'ctpfeed', action, params: { mode: 1, tokenList: [{ exchangeType, tokens }] } }));
  }

  close(): void {
    if (this.ping) clearInterval(this.ping);
    this.removeAllListeners();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
