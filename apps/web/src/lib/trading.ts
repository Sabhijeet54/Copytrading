'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrokerAccountView, CopyOrderView, MarketFeedStatus, MasterTradeView, StrategyFollowerView, StrategyView } from '@ctp/types';
import { api } from './api';

export interface LiveOrder {
  brokerOrderId: string;
  exchange: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  productType: string;
  quantity: number;
  filledQuantity: number;
  price: number | null;
  averagePrice: number | null;
  status: string;
  statusMessage?: string;
  timestamp: string;
}
export interface LivePosition {
  exchange: string;
  symbol: string;
  productType?: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number | null;
  pnl: number | null;
}
export interface LiveAccount {
  accountId: string;
  broker: string;
  brokerClientId: string | null;
  error?: string;
  funds?: { availableCash: number | null; net: number | null };
  positions?: LivePosition[];
  holdings?: LivePosition[];
  orders?: LiveOrder[];
}
export interface PaperPosition {
  id: string;
  brokerAccountId: string;
  exchange: string;
  symbol: string;
  productType: string;
  quantity: number;
  averagePrice: string;
  lastPrice: string | null;
  realizedPnl: string;
  unrealizedPnl: string;
  updatedAt?: string;
}
export type MasterTradeRow = MasterTradeView & { copyStatusCounts: Record<string, number> };
export type MasterTradeDetail = MasterTradeView & { copyOrders: CopyOrderView[] };
export type FollowerRow = StrategyFollowerView & {
  followerEmail: string;
  followerMobile: string | null;
  brokerAccount: BrokerAccountView | null;
  paperRealizedPnl: string;
  paperUnrealizedPnl: string;
};
export type StrategyWithSub = StrategyView & { subscription: StrategyFollowerView | null };

export interface StrategyInput {
  name: string;
  description?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  allowedExchanges?: string[];
  allowedInstruments?: string[];
  maxFollowers?: number;
  masterCapital: number;
  maxOrderValue?: number;
  maxQuantityPerOrder?: number;
}
export interface MasterOrderInput {
  strategyId: string;
  exchange: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL_M';
  productType: 'DELIVERY' | 'INTRADAY' | 'CARRY_FORWARD';
  price?: number;
  triggerPrice?: number;
  lotSize?: number;
  targetPrice?: number;
  stopLossPrice?: number;
}
export interface FollowInput {
  brokerAccountId: string;
  allocationMode: 'FIXED_QUANTITY' | 'CAPITAL_PERCENTAGE' | 'PROPORTIONAL';
  allocationAmount?: number;
  allocationPercent?: number;
  fixedQuantity?: number;
  maxQuantity?: number;
  maxTradeValue?: number;
  fixedLots?: number;
  maxLots?: number;
  maxDailyLoss?: number;
  maxTradesPerDay?: number;
  allowedSegments?: ('EQ' | 'FO')[];
}

const LIVE_MS = 10_000;

// ---------------------------------------------------------------- master
export const useMasterStrategies = () => useQuery({ queryKey: ['master', 'strategies'], queryFn: () => api<StrategyView[]>('/master/strategies') });
export const useMasterLive = () =>
  useQuery({
    queryKey: ['master', 'live'],
    queryFn: () => api<{ paperMode: boolean; accounts: BrokerAccountView[]; live: LiveAccount[]; paperPositions: PaperPosition[] }>('/master/live'),
    refetchInterval: LIVE_MS,
  });
export const useMasterTrades = () => useQuery({ queryKey: ['master', 'trades'], queryFn: () => api<MasterTradeRow[]>('/master/trades'), refetchInterval: LIVE_MS });
export const useMasterTrade = (id: string | null) =>
  useQuery({ queryKey: ['master', 'trade', id], queryFn: () => api<MasterTradeDetail>(`/master/trades/${id}`), enabled: !!id, refetchInterval: LIVE_MS });
export const useStrategyFollowers = (id: string | null) =>
  useQuery({ queryKey: ['master', 'followers', id], queryFn: () => api<FollowerRow[]>(`/master/strategies/${id}/followers`), enabled: !!id, refetchInterval: LIVE_MS });
export const useClientLive = (userId: string | null) =>
  useQuery({
    queryKey: ['master', 'client', userId],
    queryFn: () => api<{ live: LiveAccount[]; paperPositions: PaperPosition[] }>(`/master/clients/${userId}/live`),
    enabled: !!userId,
    refetchInterval: LIVE_MS,
  });

// ------------------------------------------------------------ live prices / exits / assignment

export type LtpMap = Record<string, { ltp: number; ts: string } | null>;

/** Cached LTPs from the server price cache (no broker calls) — polled every 2 s for live movement. */
export const useLtps = (keys: string[]) => {
  const list = [...new Set(keys.map((k) => k.toUpperCase()))].sort();
  return useQuery({
    queryKey: ['ltps', list.join(',')],
    queryFn: () => api<LtpMap>('/market/ltps', { query: { keys: list.join(',') } }),
    enabled: list.length > 0,
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });
};

export interface ExitPositionInput {
  accountId: string;
  exchange: string;
  symbol: string;
  productType: string;
}

/** Exit one running position. `clientUserId` set = master exiting a client's position. */
export function useExitPosition(clientUserId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ExitPositionInput) =>
      api<{ orderId: string | null; quantity: number }>(clientUserId ? `/master/clients/${clientUserId}/positions/exit` : '/follow/positions/exit', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['follow'] });
      void qc.invalidateQueries({ queryKey: ['master'] });
    },
  });
}

export interface AssignClientInput {
  email: string;
  allocationMode: 'FIXED_QUANTITY' | 'CAPITAL_PERCENTAGE' | 'PROPORTIONAL';
  fixedQuantity?: number;
  fixedLots?: number;
  allocationPercent?: number;
  allocationAmount?: number;
  maxDailyLoss?: number;
  startCopy?: boolean;
}

export function useAssignClient(strategyId: string, scope: 'master' | 'admin' = 'master') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignClientInput) =>
      api<{ warning: string | null }>(`/${scope}/strategies/${strategyId}/assign`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['master'] });
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export function useRemoveClient(strategyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (followerId: string) => api(`/master/strategies/${strategyId}/followers/${followerId}/remove`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['master'] }),
  });
}

export function useSaveStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: StrategyInput }) =>
      api<StrategyView>(id ? `/master/strategies/${id}` : '/master/strategies', { method: id ? 'PATCH' : 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'strategies'] }),
  });
}
export function useStrategyStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' }) =>
      api<StrategyView>(`/master/strategies/${id}/status`, { method: 'POST', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'strategies'] }),
  });
}
export function usePlaceMasterOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MasterOrderInput) => api<MasterTradeDetail>('/master/orders', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master'] }),
  });
}

// -------------------------------------------------------------- follower
export const useFollowStrategies = () => useQuery({ queryKey: ['follow', 'strategies'], queryFn: () => api<StrategyWithSub[]>('/follow/strategies') });
export const usePortfolio = () =>
  useQuery({
    queryKey: ['follow', 'portfolio'],
    queryFn: () => api<{ paperMode: boolean; live: LiveAccount[]; paperPositions: PaperPosition[]; copyOrders: CopyOrderView[] }>('/follow/portfolio'),
    refetchInterval: LIVE_MS,
  });
export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ strategyId, body }: { strategyId: string; body: FollowInput }) => api<StrategyFollowerView>(`/follow/strategies/${strategyId}`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow'] }),
  });
}
export function useToggleCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' }) => api<StrategyFollowerView>(`/follow/subscriptions/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow'] }),
  });
}

// ---------------------------------------------------------- live feed / speed / risk
export interface LatencySnapshot {
  todayCount: number;
  todayAvgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  lastMs: number | null;
  dbTodayAvgMs?: number | null;
  dbTodayCount?: number;
}
/** Feed status: pushed over the socket every 5 s (see RealtimeProvider), polled as a fallback. */
export const useFeedStatus = (enabled = true) =>
  useQuery({ queryKey: ['trading', 'feed-status'], queryFn: () => api<MarketFeedStatus>('/market/feed/status'), refetchInterval: 15_000, enabled });
export function useFeedAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { kind: 'restart' } | { kind: 'broker'; broker: 'ZERODHA' | 'ANGEL_ONE' } | { kind: 'subscribe' | 'unsubscribe'; instruments: string[] }) =>
      a.kind === 'restart'
        ? api<MarketFeedStatus>('/market/feed/restart', { method: 'POST' })
        : a.kind === 'broker'
          ? api<MarketFeedStatus>('/market/feed/broker', { method: 'POST', body: { broker: a.broker } })
          : api<MarketFeedStatus>(`/market/feed/${a.kind}`, { method: 'POST', body: { instruments: a.instruments } }),
    onSuccess: (st) => qc.setQueryData(['trading', 'feed-status'], st),
  });
}
export const useMasterLatency = (enabled = true) =>
  useQuery({ queryKey: ['trading', 'latency'], queryFn: () => api<LatencySnapshot>('/master/latency'), refetchInterval: 15_000, enabled });
export const useAdminLatency = () => useQuery({ queryKey: ['admin', 'latency'], queryFn: () => api<LatencySnapshot>('/admin/copy-trading/latency'), refetchInterval: 15_000 });
export function useExitStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ signalsClosed?: number; orders: number; failed: number; errors?: string[] }>(`/master/strategies/${id}/exit-all`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master'] }),
  });
}
export function useExitAllMine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ orders: number; failed: number }>('/follow/exit-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow'] }),
  });
}

// ------------------------------------------------------------------ signals

export interface SignalRow {
  id: string;
  strategyId: string | null;
  strategyName: string | null;
  exchange: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  productType: string;
  quantity: number;
  openQuantity: number;
  entryPrice: number | null;
  entryAt: string;
  exitPrice: number | null;
  exitAt: string | null;
  exitReason: string | null;
  targetPrice: number | null;
  stopLossPrice: number | null;
  status: 'OPEN' | 'CLOSED';
  realizedPnl: number;
  ltp: number | null;
  copyStatusCounts: Record<string, number>;
}

export const useSignals = (status: 'all' | 'open' | 'closed', scope: 'today' | 'all') =>
  useQuery({
    queryKey: ['master', 'signals', status, scope],
    queryFn: () => api<SignalRow[]>('/master/signals', { query: { status, scope } }),
    refetchInterval: 5_000,
  });

export function useSquareOffSignal(scope: 'master' | 'admin' = 'master') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ exitPrice: number | null; quantity: number; reason: string }>(`/${scope}/signals/${id}/square-off`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['master'] });
      void qc.invalidateQueries({ queryKey: ['admin-signals'] });
    },
  });
}

export function useSetSignalTpSl(scope: 'master' | 'admin' = 'master') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetPrice, stopLossPrice }: { id: string; targetPrice: number | null; stopLossPrice: number | null }) =>
      api(`/${scope}/signals/${id}/tpsl`, { method: 'PATCH', body: { targetPrice, stopLossPrice } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['master', 'signals'] });
      void qc.invalidateQueries({ queryKey: ['admin-signals'] });
    },
  });
}

export type AdminSignalRow = SignalRow & { masterName: string | null };

export const useAdminSignals = (p: { from: string; to: string; strategyIds: string[]; status: 'all' | 'open' | 'closed' }) =>
  useQuery({
    queryKey: ['admin-signals', p],
    queryFn: () =>
      api<AdminSignalRow[]>('/admin/signals', { query: { from: p.from, to: p.to, status: p.status, strategyIds: p.strategyIds.join(',') || undefined } }),
    refetchInterval: 5_000,
  });
