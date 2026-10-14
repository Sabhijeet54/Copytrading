'use client';

import { Download, RefreshCw, RotateCcw, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ExitButton, Pnl } from '@/components/live-account';
import { PageHeader } from '@/components/page-header';
import { REASON, TpSlDialog } from '@/components/signal-desk';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatINR, humanize } from '@/lib/format';
import { useAdminStrategies } from '@/lib/queries';
import { type AdminSignalRow, type SignalRow, useAdminSignals, useLtps, useSquareOffSignal } from '@/lib/trading';
import { cn } from '@/lib/utils';

const istDate = (offsetDays = 0) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const fmtDate = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

type Row = AdminSignalRow & { liveLtp: number | null; pnl: number };

/** Excel opens UTF-8 CSV with a BOM directly (₹ and names stay intact). */
function exportCsv(rows: Row[], multiplier: number) {
  const head = ['Strategy', 'Master', 'Script', 'Exchange', 'Execution date', 'Side', 'Quantity', 'Entry', 'Entry time', 'Exit', 'Exit time', 'Exit reason', 'Target', 'Stop loss', 'Status', 'LTP', 'PNL'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.strategyName,
      r.masterName,
      r.symbol,
      r.exchange,
      fmtDate(r.entryAt),
      r.side,
      r.quantity,
      r.entryPrice,
      fmtTime(r.entryAt),
      r.exitPrice,
      r.exitAt ? fmtTime(r.exitAt) : '',
      r.exitReason ? (REASON[r.exitReason] ?? r.exitReason) : '',
      r.targetPrice,
      r.stopLossPrice,
      r.status,
      r.liveLtp,
      (r.pnl * multiplier).toFixed(2),
    ]
      .map(esc)
      .join(','),
  );
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `signals-${istDate()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminSignalsPage() {
  const defaults = { from: istDate(-7), to: istDate(), strategyIds: [] as string[], status: 'all' as 'all' | 'open' | 'closed' };
  const [draft, setDraft] = useState(defaults);
  const [applied, setApplied] = useState(defaults);
  const [multiplier, setMultiplier] = useState('1');
  const [tpslRow, setTpslRow] = useState<SignalRow | null>(null);
  const strategies = useAdminStrategies({ page: 1, pageSize: 100 });
  const q = useAdminSignals(applied);
  const squareOff = useSquareOffSignal('admin');

  const rows = q.data ?? [];
  const openKeys = useMemo(() => rows.filter((r) => r.status === 'OPEN').map((r) => `${r.exchange}:${r.symbol}`), [rows]);
  const ltps = useLtps(openKeys).data;
  const mult = Number(multiplier) > 0 ? Number(multiplier) : 1;

  const view: Row[] = rows.map((r) => {
    const ltp = r.status === 'OPEN' ? (ltps?.[`${r.exchange}:${r.symbol}`.toUpperCase()]?.ltp ?? r.ltp) : null;
    const dir = r.side === 'BUY' ? 1 : -1;
    const unrealized = r.status === 'OPEN' && ltp != null && r.entryPrice != null ? r.openQuantity * (ltp - r.entryPrice) * dir : 0;
    return { ...r, liveLtp: ltp, pnl: r.realizedPnl + unrealized };
  });
  const total = view.reduce((s, r) => s + r.pnl, 0) * mult;
  const toggleStrategy = (id: string) =>
    setDraft((d) => ({ ...d, strategyIds: d.strategyIds.includes(id) ? d.strategyIds.filter((x) => x !== id) : [...d.strategyIds, id] }));

  return (
    <>
      <PageHeader
        title="Signals"
        description="Every master signal with entry, exit, target / stop loss and P&L. Open signals stream live LTP."
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-muted-foreground" htmlFor="pnl-mult">
              PNL multiplier
              <Input id="pnl-mult" className="h-8 w-20" type="number" min={0.01} step="any" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            </label>
            <span>
              Total PNL <span className="text-xs text-muted-foreground">(display only)</span> <strong><Pnl value={total} /></strong>
            </span>
            <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">{view.length} signals</span>
          </div>
        }
      />
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sig-from">Start date</Label>
              <Input id="sig-from" type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sig-to">End date</Label>
              <Input id="sig-to" type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sig-status">Status</Label>
              <Select id="sig-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as typeof draft.status })} className="w-32">
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </Select>
            </div>
            <details className="relative">
              <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border px-3 text-sm">
                {draft.strategyIds.length ? `${draft.strategyIds.length} strateg${draft.strategyIds.length > 1 ? 'ies' : 'y'}` : 'All strategies'} ▾
              </summary>
              <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border bg-card p-2 shadow-lg">
                {(strategies.data?.items ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <input type="checkbox" className="size-4" checked={draft.strategyIds.includes(s.id)} onChange={() => toggleStrategy(s.id)} />
                    {s.name}
                  </label>
                ))}
                {strategies.data?.items.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">No strategies</p> : null}
              </div>
            </details>
            <Button onClick={() => setApplied(draft)}>Filter</Button>
            <Button variant="outline" onClick={() => (setDraft(defaults), setApplied(defaults))}>
              <RotateCcw /> Reset
            </Button>
            <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={cn(q.isFetching && 'animate-spin')} /> Refresh
            </Button>
            <Button variant="outline" className="ml-auto border-emerald-600 text-emerald-700 dark:text-emerald-400" disabled={!view.length} onClick={() => exportCsv(view, mult)}>
              <Download /> Export to Excel
            </Button>
          </div>

          {openKeys.length ? (
            <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">LIVE</span> Streaming LTP for open signals
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Script</TableHead>
                  <TableHead>Execution date</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead>Entry time</TableHead>
                  <TableHead className="text-right">Exit</TableHead>
                  <TableHead>Exit time</TableHead>
                  <TableHead>TP / SL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">PNL</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="py-8 text-center text-sm text-muted-foreground">
                      {q.isLoading ? 'Loading…' : q.error ? q.error.message : 'No signals in this period'}
                    </TableCell>
                  </TableRow>
                ) : (
                  view.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {r.strategyName ?? '—'}
                        {r.masterName ? <div className="text-[11px] font-normal text-muted-foreground">{r.masterName}</div> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {r.symbol}
                        <div className="font-sans text-[11px]">{r.exchange} · {humanize(r.productType)}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.entryAt)}</TableCell>
                      <TableCell className={cn('text-xs font-semibold', r.side === 'BUY' ? 'text-success' : 'text-destructive')}>{r.side}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums text-success">{formatINR(r.entryPrice)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTime(r.entryAt)}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">{r.exitPrice != null ? formatINR(r.exitPrice) : 'N/A'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.exitAt ? fmtTime(r.exitAt) : 'N/A'}
                        {r.exitReason ? <div className="text-[11px]">{REASON[r.exitReason] ?? humanize(r.exitReason)}</div> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {r.targetPrice != null || r.stopLossPrice != null ? (
                          <>
                            <div className="text-success">T {r.targetPrice != null ? formatINR(r.targetPrice) : '—'}</div>
                            <div className="text-destructive">SL {r.stopLossPrice != null ? formatINR(r.stopLossPrice) : '—'}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className={cn('text-xs font-semibold', r.status === 'OPEN' ? 'text-success' : 'text-primary')}>{r.status === 'OPEN' ? 'OPEN' : 'CLOSE'}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-primary">{r.liveLtp != null ? formatINR(r.liveLtp) : '—'}</TableCell>
                      <TableCell className="text-right font-medium">
                        <Pnl value={r.pnl * mult} />
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === 'OPEN' ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setTpslRow(r)}>
                              <Target className="size-3.5" /> TP/SL
                            </Button>
                            <ExitButton
                              label="Square off"
                              pending={squareOff.isPending && squareOff.variables === r.id}
                              onConfirm={() =>
                                squareOff.mutate(r.id, {
                                  onSuccess: (x) => toast.success(`${r.symbol} squared off${x.exitPrice != null ? ` @ ${formatINR(x.exitPrice)}` : ''}`),
                                  onError: (err) => toast.error(err.message),
                                })
                              }
                            />
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <TpSlDialog row={tpslRow} onClose={() => setTpslRow(null)} scope="admin" />
    </>
  );
}
