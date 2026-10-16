'use client';

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
  const rows = q.data?.rows ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Trade book</CardTitle>
          <CardDescription>Every trade today with the strategy (algo) it came from — shown at your lot size from My strategies (website only, nothing sent to your demat).</CardDescription>
        </div>
        <p className="text-sm">
          Total P&amp;L: <strong className="text-base"><Pnl value={q.data?.totalPnl ?? 0} /></strong>
        </p>
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
                    {r.quantity}
                    {r.lots != null ? <span className="text-xs text-muted-foreground"> · {r.lots} lot{r.lots === 1 ? '' : 's'}</span> : null}
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
