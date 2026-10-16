'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { brokerLabel, humanize } from '@/lib/format';
import { useMyBrokerAccounts } from '@/lib/queries';
import { toastResized } from '@/lib/resize-toast';
import { type FollowInput, type StrategyWithSub, useFollow, useToggleCopy } from '@/lib/trading';

const PRESETS = ['1', '2', '3', '5'];
const num = (v: string | number | null | undefined) => (v == null || v === '' ? undefined : Number(v));

/**
 * Client settings for one assigned strategy — kept simple: broker account + lot multiplier only.
 * Limits set by the admin (max loss / day etc.) are kept unchanged when the client saves.
 */
export function FollowDialog({ s, onClose }: { s: StrategyWithSub | null; onClose: () => void }) {
  const accounts = useMyBrokerAccounts();
  const follow = useFollow();
  const toggle = useToggleCopy();
  const [brokerAccountId, setBrokerAccountId] = useState('');
  const [mult, setMult] = useState('1');
  const [applyOpen, setApplyOpen] = useState(true);
  useEffect(() => {
    if (!s) return;
    const sub = s.subscription;
    const firstConnected = accounts.data?.find((a) => a.status === 'CONNECTED' && a.broker !== 'MOCK') ?? accounts.data?.[0];
    setBrokerAccountId(sub?.brokerAccountId ?? firstConnected?.id ?? '');
    setMult(sub?.allocationMode === 'CAPITAL_PERCENTAGE' && sub.allocationPercent ? String(+(Number(sub.allocationPercent) / 100).toFixed(2)) : sub?.fixedLots ? String(sub.fixedLots) : '1');
  }, [s, accounts.data]);

  const m = Number(mult);
  const valid = m > 0 && m <= 10;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!s || !valid) return void toast.error('Lot multiplier must be between 0.01 and 10');
    const sub = s.subscription;
    const body: FollowInput = {
      brokerAccountId,
      applyToOpenTrades: applyOpen,
      allocationMode: 'CAPITAL_PERCENTAGE',
      allocationPercent: Math.round(m * 10000) / 100,
      // keep the limits the admin set
      maxQuantity: num(sub?.maxQuantity),
      maxTradeValue: num(sub?.maxTradeValue),
      maxLots: num(sub?.maxLots),
      maxDailyLoss: num(sub?.maxDailyLoss),
      maxTradesPerDay: num(sub?.maxTradesPerDay),
      allowedSegments: (sub?.allowedSegments ?? []) as ('EQ' | 'FO')[],
    };
    follow.mutate(
      { strategyId: s.id, body },
      {
        onSuccess: (r) => {
          const isNew = !s.subscription;
          toast.success(isNew ? `Connected to ${s.name} — ${m}× lots` : `Saved — ${m}× lots`);
          // New connection from the marketplace: start copying right away (needs a connected broker).
          if (isNew)
            toggle.mutate(
              { id: r.id, action: 'start' },
              { onError: (e) => toast.warning(`Connected, copying not started: ${e.message}. Press Start in My strategies.`) },
            );
          toastResized(r.resized);
          if (applyOpen && !(r.resized ?? []).length) toast.info('No open trade in this strategy — the new size applies from the next trade.');
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{s?.subscription ? s?.name : `Connect ${s?.name ?? ''}`}</DialogTitle>
          <DialogDescription>How many lots to copy for every master trade. Copying starts only when you press Start.</DialogDescription>
        </DialogHeader>
        {accounts.data && accounts.data.length === 0 ? (
          <p className="text-sm">
            Connect your broker first on the{' '}
            <Link className="underline" href="/broker">
              Broker connection
            </Link>{' '}
            page.
          </p>
        ) : (
          <form className="grid gap-4" onSubmit={save}>
            {(accounts.data?.length ?? 0) > 1 ? (
              <div className="grid gap-1.5">
                <Label htmlFor="fd-acc">Broker account</Label>
                <Select id="fd-acc" value={brokerAccountId} onChange={(e) => setBrokerAccountId(e.target.value)} required>
                  {accounts.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {brokerLabel(a.broker)} {a.brokerClientId ?? ''} — {humanize(a.status)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="fd-mult">Lot multiplier</Label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button key={p} type="button" size="sm" variant={mult === p ? 'default' : 'outline'} onClick={() => setMult(p)}>
                    {p}×
                  </Button>
                ))}
                <Input id="fd-mult" className="w-24" type="number" min={0.01} max={10} step="any" inputMode="decimal" value={mult} onChange={(e) => setMult(e.target.value)} required />
              </div>
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {valid ? (
                  <>
                    Master 1 lot → you <strong className="text-foreground">{Math.floor(m)} lot{Math.floor(m) === 1 ? '' : 's'}</strong> · master 2 lots → you{' '}
                    <strong className="text-foreground">{Math.floor(2 * m)} lots</strong> (rounded down to whole lots).
                  </>
                ) : (
                  'Enter a multiplier between 0.01 and 10'
                )}
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={applyOpen} onChange={(e) => setApplyOpen(e.target.checked)} />
              <span>
                Apply to open trades too
                <span className="block text-xs text-muted-foreground">Trades already booked are resized right away at market (e.g. 1× → 2× buys one more lot).</span>
              </span>
            </label>
            <DialogFooter>
              <Button type="submit" disabled={follow.isPending || !brokerAccountId || !valid}>
                {follow.isPending ? 'Saving…' : s?.subscription ? 'Save' : 'Connect'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
