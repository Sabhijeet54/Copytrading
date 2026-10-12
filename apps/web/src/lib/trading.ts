'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrokerAccountView, CopyOrderView, MasterTradeView, StrategyFollowerView, StrategyView } from '@ctp/types';
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
  exchange: string;
  symbol: string;
  productType: string;
  quantity: number;
  averagePrice: string;
  lastPrice: string | null;
  realizedPnl: string;
  unrealizedPnl: string;
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
}
export interface FollowInput {
  brokerAccountId: string;
  allocationMode: 'FIXED_QUANTITY' | 'CAPITAL_PERCENTAGE' | 'PROPORTIONAL';
  allocationAmount?: number;
  allocationPercent?: number;
  fixedQuantity?: number;
  maxQuantity?: number;
  maxTradeValue?: number;
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
  });

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
