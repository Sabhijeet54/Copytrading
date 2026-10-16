'use client';

import { Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Pnl } from '@/components/live-account';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatINR, humanize } from '@/lib/format';
import { useTradeBook } from '@/lib/trading';
import { cn } from '@/lib/utils';

const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** Today's trades of the client: which strategy each trade came from, entry / exit and P&L. */
export function TradeBookCard() {
  const q = useTradeBook();
  const raw = q.data?.rows ?? [];
  // Per-trade lot edit — WEBSITE ONLY (saved in this browser). Nothing is sent to the broker / demat.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    try {
      const v = localStorage.getItem('tradebook-lots');
      if (v) setEdits(JSON.parse(v));
    } catch {}
  }, []);
  const save = (next: Record<string, number>) => {
    setEdits(next);
    try {
      localStorage.setItem('tradebook-lots', JSON.stringify(next));
    } catch {}
  };
  const keyOf = (r: (typeof raw)[number]) => `${r.id}|${r.symbol}|${r.entryAt}`;
  const rows = raw.map((r) => {
    const want = edits[keyOf(r)];
    if (!want || !r.quantity) return { ...r, edited: false };
    const lotSize = r.lots ? r.quantity / r.lots : 1;
    const qty = Math.round(want * lotSize);
    const k = qty / r.quantity;
    return { ...r, quantity: qty, lots: r.lots ? want : null, pnl: Math.round(r.pnl * k * 100) / 100, edited: true };
  });
  const totalPnl = rows.reduce((a, r) => a + r.pnl, 0);
  const anyEdited = rows.some((r) => r.edited);
  const commit = (r: (typeof raw)[number]) => {
    const n = Number(draft);
    const next = { ...edits };
    if (n > 0 && n <= 10000) next[keyOf(r)] = n;
    else delete next[keyOf(r)];
    save(next);
    setEditing(null);
  };
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Trade book</CardTitle>
          <CardDescription>Every trade today with the strategy (algo) it came from — click a Qty / lots value to change the lots of any trade (open or closed) — P&L recalculates. Website only, nothing goes to your demat.</CardDescription>
        </div>
        <p className="text-sm">
          Total P&amp;L: <strong className="text-base"><Pnl value={totalPnl} /></strong>
        </p>
        {anyEdited ? (
          <button type="button" className="flex w-full items-center justify-end gap-1 text-xs text-primary underline" onClick={() => save({})}>
            <RotateCcw className="size-3" /> Reset edited lots
          </button>
        ) : null}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Algo name</TableHead>
              <TableHead>Script</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Entry time</TableHead>
              <TableHead className="text-right">Entry price</TableHead>
              <TableHead>Exit time</TableHead>
              <TableHead className="text-right">Exit price</TableHead>
              <TableHead className="text-right">Qty / lots</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  {q.isLoading ? 'Loading…' : 'No trades today'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={`${r.id}-${i}`}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap font-semibold">{r.strategyName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{r.symbol}</span>
                    <div className="text-[11px] text-muted-foreground">
                      {r.exchange} · {humanize(r.productType)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold text-white', r.side === 'BUY' ? 'bg-emerald-600' : 'bg-red-600')}>{r.side === 'BUY' ? 'Buy' : 'Sell'}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {fmtTime(r.entryAt)}
                    {r.carried ? <div className="text-[10px] font-semibold text-warning">carried from earlier day</div> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(r.entryPrice)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{r.exitAt ? fmtTime(r.exitAt) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.exitPrice != null ? formatINR(r.exitPrice) : r.ltp != null ? <span className="text-muted-foreground">LTP {formatINR(r.ltp)}</span> : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {editing === keyOf(raw[i]!) ? (
                      <Input
                        autoFocus
                        className="ml-auto h-8 w-20 text-right"
                        type="number"
                        min={r.lots != null ? 0.01 : 1}
                        step="any"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commit(raw[i]!)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(raw[i]!);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        aria-label={r.lots != null ? 'Lots' : 'Quantity'}
                      />
                    ) : (
                      <button
                        type="button"
                        title="Edit lots (website only)"
                        className={cn('inline-flex items-center gap-1 rounded px-1 hover:bg-accent', r.edited && 'font-semibold text-primary')}
                        onClick={() => {
                          setDraft(String(r.lots ?? r.quantity));
                          setEditing(keyOf(raw[i]!));
                        }}
                      >
                        {r.quantity}
                        {r.lots != null ? <span className="text-xs text-muted-foreground"> · {r.lots} lot{r.lots === 1 ? '' : 's'}</span> : null}
                        <Pencil className="size-3 text-muted-foreground" />
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Pnl value={r.pnl} />
                  </TableCell>
                  <TableCell>
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', r.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-accent text-accent-foreground')}>
                      {r.status === 'OPEN' ? 'Open' : 'Closed'}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
