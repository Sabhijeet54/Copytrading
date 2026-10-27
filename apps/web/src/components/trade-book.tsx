'use client';

import { Pnl } from '@/components/live-account';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatINR, humanize } from '@/lib/format';
import { type TradeBookRow, useTradeBook } from '@/lib/trading';
import { cn } from '@/lib/utils';

const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/**
 * Broker side of a LIVE strategy trade, shown as a neutral hint only. The broker's own status (incl. Rejected)
 * is shown in the Orders section; a trade is called "executed" only when the broker confirmed a fill.
 */
function ExecutionHint({ r }: { r: TradeBookRow }) {
  if (r.mode !== 'LIVE') return null;
  if (r.execution === 'EXECUTED') return <span className="block text-[10px] font-medium text-success">Executed at broker</span>;
  if (r.execution === 'PARTIAL') return <span className="block text-[10px] font-medium text-warning">Partly executed at broker</span>;
  if (r.execution === 'PENDING') return <span className="block text-[10px] text-muted-foreground">Broker order pending</span>;
  return <span className="block text-[10px] text-muted-foreground">Software trade · see Orders</span>;
}

/**
 * Portfolio / Positions: today's software-generated strategy trades (internal trade ledger). Same format for
 * Paper and Live and whatever the broker did — the status is the strategy trade's Open / Closed.
 */
export function TradeBookCard() {
  const q = useTradeBook();
  const rows = q.data?.rows ?? [];
  const sw = q.data?.software;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Strategy trades</CardTitle>
          <CardDescription>
            Every strategy-generated trade today (Live and Paper), at your lot size. Status is the strategy trade&apos;s Open / Closed — the broker&apos;s order status is in the Orders tab
            (match by Trade ID).
          </CardDescription>
        </div>
        <div className="text-right text-sm">
          <p>
            Software P&amp;L:{' '}
            <strong className="text-base">
              <Pnl value={sw?.totalPnl ?? 0} />
            </strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Realized <Pnl value={sw?.realizedPnl ?? 0} /> · Unrealized <Pnl value={sw?.unrealizedPnl ?? 0} />
          </p>
          <p className="text-xs text-muted-foreground">
            {sw?.trades ?? 0} trades · {sw?.open ?? 0} open · {sw?.closed ?? 0} closed
          </p>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trade ID</TableHead>
              <TableHead>Algo name</TableHead>
              <TableHead>Mode</TableHead>
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
                <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                  {q.isLoading ? 'Loading…' : 'No strategy trades today'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.tradeId}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground" title={r.tradeId}>
                    {r.tradeRef}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-semibold">{r.strategyName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', r.mode === 'LIVE' ? 'bg-emerald-600 text-white' : 'bg-amber-400 text-black')}>
                      {r.mode === 'LIVE' ? 'Live' : 'Paper'}
                    </span>
                    <ExecutionHint r={r} />
                  </TableCell>
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
        <p className="mt-3 text-xs text-muted-foreground">
          Software P&amp;L is the strategy&apos;s result at the strategy&apos;s prices — it is not money in your Demat. Actual broker-executed P&amp;L is shown separately
          {q.data ? (
            <>
              {' '}
              (<Pnl value={q.data.brokerExecuted.totalPnl} />)
            </>
          ) : null}
          .
        </p>
      </CardContent>
    </Card>
  );
}
