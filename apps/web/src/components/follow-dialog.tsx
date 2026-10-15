'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { brokerLabel, formatINR, humanize } from '@/lib/format';
import { useMyBrokerAccounts } from '@/lib/queries';
import { type FollowInput, type StrategyWithSub, useFollow } from '@/lib/trading';

const optNum = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function FollowDialog({ s, onClose }: { s: StrategyWithSub | null; onClose: () => void }) {
  const accounts = useMyBrokerAccounts();
  const follow = useFollow();
  const [f, setF] = useState({ brokerAccountId: '', mode: 'CAPITAL_PERCENTAGE', percent: '1', amount: '', fixed: '', fixedLots: '', maxQty: '', maxValue: '', maxLots: '', maxLoss: '', maxTrades: '', eq: true, fo: true });
  useEffect(() => {
    if (!s) return;
    const sub = s.subscription;
    const firstConnected = accounts.data?.find((a) => a.status === 'CONNECTED' && a.broker !== 'MOCK') ?? accounts.data?.[0];
    setF({
      brokerAccountId: sub?.brokerAccountId ?? firstConnected?.id ?? '',
      mode: sub?.allocationMode ?? 'CAPITAL_PERCENTAGE',
      percent: sub?.allocationPercent ? String(+(Number(sub.allocationPercent) / 100).toFixed(2)) : '1',
      amount: sub?.allocationAmount ? String(Number(sub.allocationAmount)) : '',
      fixed: sub?.fixedQuantity ? String(sub.fixedQuantity) : '',
      maxQty: sub?.maxQuantity ? String(sub.maxQuantity) : '',
      maxValue: sub?.maxTradeValue ? String(Number(sub.maxTradeValue)) : '',
      fixedLots: sub?.fixedLots ? String(sub.fixedLots) : '',
      maxLots: sub?.maxLots ? String(sub.maxLots) : '',
      maxLoss: sub?.maxDailyLoss ? String(Number(sub.maxDailyLoss)) : '',
      maxTrades: sub?.maxTradesPerDay ? String(sub.maxTradesPerDay) : '',
      eq: !sub?.allowedSegments?.length || sub.allowedSegments.includes('EQ'),
      fo: !sub?.allowedSegments?.length || sub.allowedSegments.includes('FO'),
    });
  }, [s, accounts.data]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow {s?.name}</DialogTitle>
          <DialogDescription>Choose how much of each master trade is copied into your account. Copying starts only when you press Start.</DialogDescription>
        </DialogHeader>
        {accounts.data && accounts.data.length === 0 ? (
          <p className="text-sm">
            Connect your broker first on the <Link className="underline" href="/broker">Broker connection</Link> page.
          </p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const body: FollowInput = {
                brokerAccountId: f.brokerAccountId,
                allocationMode: f.mode as FollowInput['allocationMode'],
                allocationPercent: f.mode === 'CAPITAL_PERCENTAGE' && optNum(f.percent) ? Math.round(Number(f.percent) * 10000) / 100 : undefined,
                allocationAmount: f.mode === 'PROPORTIONAL' ? optNum(f.amount) : undefined,
                fixedQuantity: f.mode === 'FIXED_QUANTITY' ? optNum(f.fixed) : undefined,
                maxQuantity: optNum(f.maxQty),
                maxTradeValue: optNum(f.maxValue),
                fixedLots: f.mode === 'FIXED_QUANTITY' ? optNum(f.fixedLots) : undefined,
                maxLots: optNum(f.maxLots),
                maxDailyLoss: optNum(f.maxLoss),
                maxTradesPerDay: optNum(f.maxTrades),
                allowedSegments: f.eq && f.fo ? [] : [...(f.eq ? (['EQ'] as const) : []), ...(f.fo ? (['FO'] as const) : [])],
              };
              if (!f.eq && !f.fo) return void toast.error('Allow at least one segment (EQ or F&O)');
              follow.mutate({ strategyId: s!.id, body }, { onSuccess: () => (toast.success('Saved — press Start to begin copying'), onClose()), onError: (err) => toast.error(err.message) });
            }}
          >
            <div className="grid gap-1.5">
              <Label>Broker account</Label>
              <Select value={f.brokerAccountId} onChange={set('brokerAccountId')} required>
                {accounts.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {brokerLabel(a.broker)} {a.brokerClientId ?? ''} — {humanize(a.status)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Allocation</Label>
              <Select value={f.mode} onChange={set('mode')}>
                <option value="CAPITAL_PERCENTAGE">Lot multiplier (× master lots)</option>
                <option value="PROPORTIONAL">My capital (proportional to master)</option>
                <option value="FIXED_QUANTITY">Fixed lots / quantity per trade</option>
              </Select>
            </div>
            {f.mode === 'CAPITAL_PERCENTAGE' ? (
              <div className="grid gap-1.5">
                <Label>Lot multiplier (×)</Label>
                <Input type="number" min={0.01} max={10} step="any" value={f.percent} onChange={set('percent')} required />
                <p className="text-xs text-muted-foreground">1 = same lots as master, 2 = double lots, 0.5 = half (rounded down to whole lots)</p>
              </div>
            ) : f.mode === 'PROPORTIONAL' ? (
              <div className="grid gap-1.5">
                <Label>My capital for this strategy (₹)</Label>
                <Input type="number" min={1} value={f.amount} onChange={set('amount')} required />
                <p className="text-xs text-muted-foreground">Master capital: {formatINR(s?.masterCapital)}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label>Lots per trade</Label>
                  <Input type="number" min={1} value={f.fixedLots} onChange={set('fixedLots')} placeholder="e.g. 1" />
                </div>
                <div className="grid gap-1.5">
                  <Label>or Quantity per trade</Label>
                  <Input type="number" min={1} value={f.fixed} onChange={set('fixed')} required={!f.fixedLots} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>Max qty / order</Label>
                <Input type="number" min={1} value={f.maxQty} onChange={set('maxQty')} />
              </div>
              <div className="grid gap-1.5">
                <Label>Max order value ₹</Label>
                <Input type="number" min={0} value={f.maxValue} onChange={set('maxValue')} />
              </div>
              <div className="grid gap-1.5">
                <Label>Max lots / order</Label>
                <Input type="number" min={1} value={f.maxLots} onChange={set('maxLots')} />
              </div>
              <div className="grid gap-1.5">
                <Label>Max trades / day</Label>
                <Input type="number" min={1} value={f.maxTrades} onChange={set('maxTrades')} />
              </div>
              <div className="col-span-2 grid gap-1.5">
                <Label>Max loss per day ₹</Label>
                <Input type="number" min={0} value={f.maxLoss} onChange={set('maxLoss')} placeholder="Copy stops and positions exit when hit" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted-foreground">Segments:</span>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={f.eq} onChange={(e) => setF((p) => ({ ...p, eq: e.target.checked }))} /> Equity (EQ)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={f.fo} onChange={(e) => setF((p) => ({ ...p, fo: e.target.checked }))} /> F&amp;O
              </label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={follow.isPending || !f.brokerAccountId}>
                {follow.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

