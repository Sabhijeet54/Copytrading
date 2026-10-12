import type { Exchange, OrderSide, OrderStatus, OrderType, ProductType } from '@ctp/database';

/** Broker-neutral order request. `symbol` is the platform's canonical trading symbol (e.g. "INFY", "NIFTY24OCT25000CE"). */
export interface PlaceOrderInput {
  exchange: Exchange;
  symbol: string;
  side: OrderSide;
  quantity: number;
  orderType: OrderType;
  productType: ProductType;
  price?: number | null;
  triggerPrice?: number | null;
  tag?: string;
}

export interface BrokerOrder {
  brokerOrderId: string;
  exchange: Exchange;
  symbol: string;
  instrumentToken?: string;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  quantity: number;
  filledQuantity: number;
  price: number | null;
  averagePrice: number | null;
  status: OrderStatus;
  statusMessage?: string;
  lotSize?: number;
  timestamp: Date;
  raw: unknown;
}

export interface BrokerPosition {
  exchange: Exchange;
  symbol: string;
  productType: ProductType;
  quantity: number;
  averagePrice: number;
  lastPrice: number | null;
  pnl: number | null;
}

export interface BrokerHolding {
  exchange: Exchange;
  symbol: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number | null;
  pnl: number | null;
}

export interface BrokerFunds {
  availableCash: number | null;
  net: number | null;
}

export interface BrokerAdapter {
  placeOrder(input: PlaceOrderInput): Promise<{ brokerOrderId: string }>;
  orders(): Promise<BrokerOrder[]>;
  positions(): Promise<BrokerPosition[]>;
  holdings(): Promise<BrokerHolding[]>;
  funds(): Promise<BrokerFunds>;
  /** Last traded price, when the broker API allows it (Kite Personal does not). */
  ltp(exchange: Exchange, symbol: string): Promise<number | null>;
}

export const EXCHANGES: Exchange[] = ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS', 'BCD'];

export function toExchange(v: string): Exchange {
  const e = v?.toUpperCase() as Exchange;
  if (!EXCHANGES.includes(e)) throw new Error(`Unsupported exchange "${v}"`);
  return e;
}

/** Canonical symbol: Angel equity symbols carry a "-EQ"/"-BE" series suffix that Zerodha does not. */
export function canonicalSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/-(EQ|BE|BZ|SM|ST)$/, '');
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
