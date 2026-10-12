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
