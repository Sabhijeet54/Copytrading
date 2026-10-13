'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { LiveAccountCard, PaperPositionsCard } from '@/components/live-account';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { brokerLabel, formatDateTime, formatINR, humanize } from '@/lib/format';
import { useMyBrokerAccounts } from '@/lib/queries';
import { type FollowInput, type StrategyWithSub, useExitAllMine, useFollow, useFollowStrategies, usePortfolio, useToggleCopy } from '@/lib/trading';

const optNum = (v: string) => (v.trim() === '' ? undefined : Number(v));

function FollowDialog({ s, onClose }: { s: StrategyWithSub | null; onClose: () => void }) {
  const accounts = useMyBrokerAccounts();
  const follow = useFollow();
  const [f, setF] = useState({ brokerAccountId: '', mode: 'CAPITAL_PERCENTAGE', percent: '100', amount: '', fixed: '', fixedLots: '', maxQty: '', maxValue: '', maxLots: '', maxLoss: '', maxTrades: '', eq: true, fo: true });
  useEffect(() => {
    if (!s) return;
    const sub = s.subscription;
    const firstConnected = accounts.data?.find((a) => a.status === 'CONNECTED' && a.broker !== 'MOCK') ?? accounts.data?.[0];
    setF({
      brokerAccountId: sub?.brokerAccountId ?? firstConnected?.id ?? '',
      mode: sub?.allocationMode ?? 'CAPITAL_PERCENTAGE',
      percent: sub?.allocationPercent ? String(Number(sub.allocationPercent)) : '100',
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
            Connect your broker first on the <Link className="underline" href="/dashboard">Dashboard</Link>.
          </p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const body: FollowInput = {
                brokerAccountId: f.brokerAccountId,
                allocationMode: f.mode as FollowInput['allocationMode'],
                allocationPercent: f.mode === 'CAPITAL_PERCENTAGE' ? optNum(f.percent) : undefined,
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
                <option value="CAPITAL_PERCENTAGE">Multiplier (% of master quantity)</option>
                <option value="PROPORTIONAL">My capital (proportional to master)</option>
                <option value="FIXED_QUANTITY">Fixed lots / quantity per trade</option>
              </Select>
            </div>
            {f.mode === 'CAPITAL_PERCENTAGE' ? (
              <div className="grid gap-1.5">
                <Label>Percent of master quantity</Label>
                <Input type="number" min={0.01} step="0.01" value={f.percent} onChange={set('percent')} required />
                <p className="text-xs text-muted-foreground">100 = 1× (same qty as master), 200 = 2×, 50 = 0.5×</p>
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

export default function PortfolioPage() {
  const strategies = useFollowStrategies();
  const portfolio = usePortfolio();
  const toggle = useToggleCopy();
  const exitAll = useExitAllMine();
  const [exitOpen, setExitOpen] = useState(false);
  const [follow, setFollow] = useState<StrategyWithSub | null>(null);
  const p = portfolio.data;

  return (
    <>
      <PageHeader
        title="My portfolio"
        description="Strategies you follow, your live positions and every copied trade."
        actions={
          <Button variant="destructive" size="sm" onClick={() => setExitOpen(true)}>
            Exit all &amp; stop copy
          </Button>
        }
      />
      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exit all positions and stop copying?</DialogTitle>
            <DialogDescription>All your copy subscriptions are turned OFF and every open position in your trading account is closed at MARKET.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExitOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={exitAll.isPending}
              onClick={() =>
                exitAll.mutate(undefined, {
                  onSuccess: (r) => (toast.success(`Copy stopped · ${r.orders} exit order(s)${r.failed ? `, ${r.failed} failed` : ''}`), setExitOpen(false)),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              {exitAll.isPending ? 'Exiting…' : 'Exit all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {p?.paperMode ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <strong>Paper mode is ON</strong> — copied trades are simulated, no real orders are placed in your account.
        </p>
      ) : null}

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Strategies</CardTitle>
            <CardDescription>Follow a strategy, set your allocation, then press Start to copy its trades.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Master</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>My copying</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(strategies.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      {strategies.isLoading ? 'Loading…' : 'No strategies available yet'}
                    </TableCell>
                  </TableRow>
                ) : (
                  strategies.data!.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="max-w-72 truncate text-xs text-muted-foreground">{s.description}</div>
                      </TableCell>
                      <TableCell>{s.masterName}</TableCell>
                      <TableCell>{humanize(s.riskLevel)}</TableCell>
                      <TableCell>{s.subscription ? <StatusBadge value={s.subscription.copyStatus} /> : <span className="text-sm text-muted-foreground">Not following</span>}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setFollow(s)}>
                            {s.subscription ? 'Settings' : 'Follow'}
                          </Button>
                          {s.subscription ? (
                            s.subscription.copyStatus === 'ON' ? (
                              <Button size="sm" variant="destructive" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: s.subscription!.id, action: 'stop' }, { onSuccess: () => toast.success('Copying stopped'), onError: (e) => toast.error(e.message) })}>
                                Stop
                              </Button>
                            ) : (
                              <Button size="sm" disabled={toggle.isPending || s.status !== 'ACTIVE'} onClick={() => toggle.mutate({ id: s.subscription!.id, action: 'start' }, { onSuccess: () => toast.success('Copying started'), onError: (e) => toast.error(e.message) })}>
                                Start
                              </Button>
                            )
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <h2 className="mt-2 text-lg font-semibold">Running positions</h2>
        {portfolio.isLoading ? <p className="text-sm text-muted-foreground">Loading live data…</p> : null}
        {p && p.live.length === 0 && p.paperPositions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect your broker on the <Link className="underline" href="/dashboard">Dashboard</Link> to see live positions.
          </p>
        ) : null}
        {p?.live.map((a) => <LiveAccountCard key={a.accountId} a={a} />)}
        {p && p.paperPositions.length > 0 ? <PaperPositionsCard rows={p.paperPositions} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Copied trades</CardTitle>
            <CardDescription>Every master trade copied (or skipped) for your account.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(p?.copyOrders ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      No copied trades yet
                    </TableCell>
                  </TableRow>
                ) : (
                  p!.copyOrders.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(c.createdAt)}</TableCell>
                      <TableCell>
                        <span className={c.side === 'BUY' ? 'text-success' : 'text-destructive'}>{c.side}</span> {c.quantity} <span className="font-medium">{c.symbol}</span>{' '}
                        <span className="text-xs text-muted-foreground">{c.exchange}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(c.averagePrice)}</TableCell>
                      <TableCell>
                        {c.errorCode === 'MISSED' ? <StatusBadge value="WARNING" label="Missed · paper" /> : <StatusBadge value={c.status} />}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={c.errorMessage ?? ''}>
                        {c.errorMessage ?? (c.brokerOrderId ? `Order ${c.brokerOrderId}` : '')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <FollowDialog s={follow} onClose={() => setFollow(null)} />
    </>
  );
}
