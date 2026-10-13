/**
 * WebSocket event names pushed from the API gateway to browsers.
 * The gateway itself is implemented in Phase 3; names are fixed here so
 * every app agrees on them from day one.
 */
export const WsEvent = {
  MASTER_TRADE_DETECTED: 'master.trade.detected',
  COPY_ORDER_CREATED: 'copy.order.created',
  COPY_ORDER_SUBMITTED: 'copy.order.submitted',
  COPY_ORDER_FILLED: 'copy.order.filled',
  COPY_ORDER_FAILED: 'copy.order.failed',
  BROKER_CONNECTED: 'broker.connected',
  BROKER_DISCONNECTED: 'broker.disconnected',
  BROKER_TOKEN_EXPIRING: 'broker.token.expiring',
  BROKER_TOKEN_EXPIRED: 'broker.token.expired',
  /** Another platform user connected this same broker client ID; this user was disconnected. */
  BROKER_TAKEN_OVER: 'broker.taken_over',
  MARKET_FEED_STATUS: 'market.feed.status',
  RISK_LIMIT_HIT: 'risk.limit.hit',
  KILL_SWITCH: 'kill.switch',
  POSITION_UPDATED: 'position.updated',
  PNL_UPDATED: 'pnl.updated',
  NOTIFICATION_CREATED: 'notification.created',
} as const;
export type WsEvent = (typeof WsEvent)[keyof typeof WsEvent];

/** Redis keys shared between API and worker. */
export const RedisKeys = {
  /** JSON WorkerHeartbeat, written by the worker with a TTL; absent = worker down. */
  workerHeartbeat: 'ctp:worker:heartbeat',
  /** JSON CopyHaltState. When present, the copy engine must not create or submit any follower orders. */
  copyHalted: 'ctp:copy:halted',
  rateLimitPrefix: 'ctp:rl:',
  /** Hash exchange:symbol -> JSON {ltp, ts}. Written by the master market feed. */
  ltpHash: 'ctp:ltp',
  /** JSON MarketFeedStatus. */
  feedStatus: 'ctp:feed:status',
} as const;

export interface WorkerHeartbeat {
  pid: number;
  host: string;
  startedAt: string;
  at: string;
  paperMode: boolean;
}

export interface CopyHaltState {
  haltedAt: string;
  haltedByUserId: string;
  reason: string;
}

export interface MarketFeedStatus {
  state: 'LIVE' | 'CONNECTING' | 'DOWN' | 'STOPPED';
  broker: 'ZERODHA' | 'ANGEL_ONE' | null;
  brokerAccountId: string | null;
  lastTickAt: string | null;
  /** Seconds since the last tick (null when none yet). */
  lastTickAgoSec: number | null;
  subscribed: string[];
  reconnects: number;
  error: string | null;
}

/** Payload of broker.* realtime events. */
export interface BrokerEventPayload {
  brokerAccountId: string;
  broker: string;
  brokerClientId: string | null;
  reason?: string;
}

export interface NotificationPayload {
  id: string;
  type: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  body: string | null;
  createdAt: string;
}
