import type { OrderStatus, OrderType, ProductType } from '@ctp/database';
import { BrokerApiError, brokerFetch } from '../brokers/broker-http';
import {
  AdapterOptions,
  assertCanTrade,
  BrokerAdapter,
  BrokerFunds,
  BrokerHolding,
  BrokerOrder,
  BrokerPosition,
  canonicalSymbol,
  num,
  PlaceOrderInput,
  toExchange,
} from './broker-adapter';

export const KITE_API_ROOT = 'https://api.kite.trade';
const API_ROOT = KITE_API_ROOT;

const PRODUCT_OUT: Record<ProductType, string> = { DELIVERY: 'CNC', INTRADAY: 'MIS', CARRY_FORWARD: 'NRML' };
const PRODUCT_IN: Record<string, ProductType> = { CNC: 'DELIVERY', MIS: 'INTRADAY', NRML: 'CARRY_FORWARD', MTF: 'DELIVERY' };
const TYPE_OUT: Record<OrderType, string> = { MARKET: 'MARKET', LIMIT: 'LIMIT', SL: 'SL', SL_M: 'SL-M' };
const TYPE_IN: Record<string, OrderType> = { MARKET: 'MARKET', LIMIT: 'LIMIT', SL: 'SL', 'SL-M': 'SL_M' };

function status(s: string): OrderStatus {
  const v = (s ?? '').toUpperCase();
  if (v === 'COMPLETE') return 'FILLED';
  if (v === 'REJECTED') return 'REJECTED';
  if (v === 'CANCELLED') return 'CANCELLED';
  if (v === 'OPEN' || v === 'TRIGGER PENDING' || v.includes('PENDING') || v.includes('REQ')) return 'OPEN';
  return 'UNKNOWN';
}

interface Env<T> {
  status: string;
  data?: T;
  message?: string;
  error_type?: string;
}

/** Kite Connect v3 REST adapter. */
export class ZerodhaAdapter implements BrokerAdapter {
  readonly broker = 'ZERODHA';
  constructor(
    private readonly apiKey: string,
    private readonly accessToken: string,
    private readonly proxyUrl?: string,
    private readonly opts?: AdapterOptions,
  ) {}

  private async call<T>(path: string, method: 'GET' | 'POST' = 'GET', form?: Record<string, string>): Promise<T> {
    const { status: http, body } = await brokerFetch<Env<T>>(`${API_ROOT}${path}`, {
      method,
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${this.apiKey}:${this.accessToken}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      proxyUrl: this.proxyUrl,
    });
    if (http !== 200 || body?.status !== 'success') {
      throw new BrokerApiError(body?.message ?? `Zerodha request failed (HTTP ${http}).`, http, body?.error_type);
    }
    return body.data as T;
  }

  async placeOrder(o: PlaceOrderInput): Promise<{ brokerOrderId: string }> {
    assertCanTrade(this.opts);
    const form: Record<string, string> = {
      tradingsymbol: canonicalSymbol(o.symbol),
      exchange: o.exchange,
      transaction_type: o.side,
      order_type: TYPE_OUT[o.orderType],
      quantity: String(o.quantity),
      product: PRODUCT_OUT[o.productType],
      validity: 'DAY',
    };
    if (o.price != null && o.orderType !== 'MARKET' && o.orderType !== 'SL_M') form.price = String(o.price);
    if (o.triggerPrice != null && (o.orderType === 'SL' || o.orderType === 'SL_M')) form.trigger_price = String(o.triggerPrice);
    if (o.tag) form.tag = o.tag.slice(0, 20);
    const d = await this.call<{ order_id: string }>('/orders/regular', 'POST', form);
    return { brokerOrderId: d.order_id };
  }

  async orders(): Promise<BrokerOrder[]> {
    const rows = (await this.call<Record<string, unknown>[]>('/orders')) ?? [];
    return rows.map((r) => ({
      brokerOrderId: String(r.order_id),
      exchange: toExchange(String(r.exchange)),
      symbol: canonicalSymbol(String(r.tradingsymbol)),
      instrumentToken: r.instrument_token ? String(r.instrument_token) : undefined,
      side: String(r.transaction_type) === 'SELL' ? 'SELL' : 'BUY',
      orderType: TYPE_IN[String(r.order_type)] ?? 'MARKET',
      productType: PRODUCT_IN[String(r.product)] ?? 'INTRADAY',
      quantity: Number(r.quantity) || 0,
      filledQuantity: Number(r.filled_quantity) || 0,
      price: num(r.price),
      averagePrice: num(r.average_price),
      status: status(String(r.status)),
      statusMessage: r.status_message ? String(r.status_message) : undefined,
      timestamp: new Date(String(r.exchange_timestamp ?? r.order_timestamp ?? Date.now()).replace(' ', 'T') + '+05:30'),
      raw: r,
    }));
  }

  async positions(): Promise<BrokerPosition[]> {
    const d = await this.call<{ net: Record<string, unknown>[] }>('/portfolio/positions');
    return (d?.net ?? []).map((p) => ({
      exchange: toExchange(String(p.exchange)),
      symbol: canonicalSymbol(String(p.tradingsymbol)),
      productType: PRODUCT_IN[String(p.product)] ?? 'INTRADAY',
      quantity: Number(p.quantity) || 0,
      averagePrice: num(p.average_price) ?? 0,
      lastPrice: num(p.last_price),
      pnl: num(p.pnl),
    }));
  }

  async holdings(): Promise<BrokerHolding[]> {
    const rows = (await this.call<Record<string, unknown>[]>('/portfolio/holdings')) ?? [];
    return rows.map((h) => ({
      exchange: toExchange(String(h.exchange)),
      symbol: canonicalSymbol(String(h.tradingsymbol)),
      quantity: (Number(h.quantity) || 0) + (Number(h.t1_quantity) || 0),
      averagePrice: num(h.average_price) ?? 0,
      lastPrice: num(h.last_price),
      pnl: num(h.pnl),
    }));
  }

  async funds(): Promise<BrokerFunds> {
    const d = await this.call<{ equity?: { net?: number; available?: { cash?: number; live_balance?: number } } }>('/user/margins');
    return { availableCash: num(d?.equity?.available?.live_balance ?? d?.equity?.available?.cash), net: num(d?.equity?.net) };
  }

  async ltp(exchange: string, symbol: string): Promise<number | null> {
    try {
      const key = `${exchange}:${canonicalSymbol(symbol)}`;
      const d = await this.call<Record<string, { last_price: number }>>(`/quote/ltp?i=${encodeURIComponent(key)}`);
      return num(d?.[key]?.last_price);
    } catch {
      return null; // Kite Personal apps have no quote access.
    }
  }
}
