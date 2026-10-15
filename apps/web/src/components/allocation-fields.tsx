'use client';

import type { StrategyFollowerView } from '@ctp/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { AssignStrategyInput } from '@/lib/trading';

/**
 * How much of each master trade a client copies.
 *  - LOT_MULTIPLIER: × master lots (1 = same lots as master, 2 = double, 0.5 = half) — stored as % of master qty
 *  - FIXED_LOTS / FIXED_QTY: always the same size
 *  - CAPITAL: proportional to the client's capital vs the master's capital
 */
export type AllocKind = 'LOT_MULTIPLIER' | 'FIXED_LOTS' | 'FIXED_QTY' | 'CAPITAL';
export interface AllocState {
  kind: AllocKind;
  value: string;
  maxLoss: string;
}

export const ALLOC_LABEL: Record<AllocKind, string> = {
  LOT_MULTIPLIER: 'Lot multiplier (× master lots)',
  FIXED_LOTS: 'Fixed lots per trade',
  FIXED_QTY: 'Fixed quantity per trade',
  CAPITAL: 'Capital based (proportional)',
};
const VALUE_LABEL: Record<AllocKind, string> = {
  LOT_MULTIPLIER: 'Multiplier ×',
  FIXED_LOTS: 'Lots',
  FIXED_QTY: 'Quantity',
  CAPITAL: 'Client capital ₹',
};
const HINT: Record<AllocKind, string> = {
  LOT_MULTIPLIER: '1 = same lots as master, 2 = double, 0.5 = half (rounded down to whole lots)',
  FIXED_LOTS: 'Same number of lots on every trade',
  FIXED_QTY: 'Same quantity on every trade',
  CAPITAL: 'Client capital ÷ master capital × master quantity',
};

export const defaultAlloc = (): AllocState => ({ kind: 'LOT_MULTIPLIER', value: '1', maxLoss: '' });

/** Pre-fills the editor from an existing subscription. */
export function allocFromSub(s: StrategyFollowerView | null | undefined): AllocState {
  if (!s) return defaultAlloc();
  const maxLoss = s.maxDailyLoss ? String(Number(s.maxDailyLoss)) : '';
  if (s.allocationMode === 'CAPITAL_PERCENTAGE') return { kind: 'LOT_MULTIPLIER', value: String(+(Number(s.allocationPercent ?? 100) / 100).toFixed(2)), maxLoss };
  if (s.allocationMode === 'PROPORTIONAL') return { kind: 'CAPITAL', value: String(Number(s.allocationAmount ?? 0)), maxLoss };
  if (s.fixedLots) return { kind: 'FIXED_LOTS', value: String(s.fixedLots), maxLoss };
  return { kind: 'FIXED_QTY', value: String(s.fixedQuantity ?? ''), maxLoss };
}

/** Converts the editor state to the API body; returns an error message when invalid. */
export function allocToInput(a: AllocState): AssignStrategyInput | string {
  const v = Number(a.value);
  if (!(v > 0)) return `${VALUE_LABEL[a.kind]} must be greater than 0`;
  const maxDailyLoss = a.maxLoss.trim() ? Number(a.maxLoss) : undefined;
  switch (a.kind) {
    case 'LOT_MULTIPLIER':
      if (v > 10) return 'Lot multiplier can be at most 10×';
      return { allocationMode: 'CAPITAL_PERCENTAGE', allocationPercent: Math.round(v * 10000) / 100, maxDailyLoss };
    case 'FIXED_LOTS':
      return { allocationMode: 'FIXED_QUANTITY', fixedLots: Math.round(v), maxDailyLoss };
    case 'FIXED_QTY':
      return { allocationMode: 'FIXED_QUANTITY', fixedQuantity: Math.round(v), maxDailyLoss };
    default:
      return { allocationMode: 'PROPORTIONAL', allocationAmount: v, maxDailyLoss };
  }
}

export function AllocationFields({ id, value, onChange, compact = false }: { id: string; value: AllocState; onChange: (v: AllocState) => void; compact?: boolean }) {
  return (
    <div className={compact ? 'grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr]' : 'grid gap-3'}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-kind`}>Allocation</Label>
        <Select id={`${id}-kind`} value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as AllocKind, value: e.target.value === 'LOT_MULTIPLIER' ? '1' : '' })}>
          {(Object.keys(ALLOC_LABEL) as AllocKind[]).map((k) => (
            <option key={k} value={k}>
              {ALLOC_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-val`}>{VALUE_LABEL[value.kind]}</Label>
        <Input
          id={`${id}-val`}
          type="number"
          min={value.kind === 'LOT_MULTIPLIER' ? 0.01 : 1}
          max={value.kind === 'LOT_MULTIPLIER' ? 10 : undefined}
          step={value.kind === 'LOT_MULTIPLIER' || value.kind === 'CAPITAL' ? 'any' : 1}
          inputMode="decimal"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-loss`}>Max loss / day ₹</Label>
        <Input id={`${id}-loss`} type="number" min={0} step="any" inputMode="decimal" placeholder="Optional" value={value.maxLoss} onChange={(e) => onChange({ ...value, maxLoss: e.target.value })} />
      </div>
      {!compact ? <p className="-mt-1 text-xs text-muted-foreground">{HINT[value.kind]}</p> : <p className="text-xs text-muted-foreground sm:col-span-3">{HINT[value.kind]}</p>}
    </div>
  );
}
