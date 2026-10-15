import type { StrategyFollower } from '@ctp/database';

/** stoppedReason written when a master / admin removes a client from a strategy: the client loses access to it. */
export const REMOVED_REASON = 'Removed from strategy';

export const isRemoved = (f: Pick<StrategyFollower, 'copyStatus' | 'stoppedReason'>) => f.copyStatus === 'OFF' && f.stoppedReason === REMOVED_REASON;

/** Human label of a subscription's allocation ("2× lots", "1 lot", "₹50,000"). */
export function allocationLabel(s: Pick<StrategyFollower, 'allocationMode' | 'allocationPercent' | 'allocationAmount' | 'fixedLots' | 'fixedQuantity'>): string {
  if (s.allocationMode === 'FIXED_QUANTITY') return s.fixedLots ? `${s.fixedLots} lot${s.fixedLots > 1 ? 's' : ''}` : `${s.fixedQuantity ?? 0} qty`;
  if (s.allocationMode === 'CAPITAL_PERCENTAGE') return `${+(Number(s.allocationPercent ?? 0) / 100).toFixed(2)}× lots`;
  return `₹${Number(s.allocationAmount ?? 0).toLocaleString('en-IN')} capital`;
}
