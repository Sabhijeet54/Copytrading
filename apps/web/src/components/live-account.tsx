'use client';

import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { brokerLabel, formatINR, formatNumber, humanize } from '@/lib/format';
import type { LiveAccount, LivePosition, PaperPosition } from '@/lib/trading';
import { cn } from '@/lib/utils';

export function Pnl({ value }: { value: number | string | null | undefined }) {
  const n = value == null ? null : Number(value);
  return <span className={cn('tabular-nums', n != null && n > 0 && 'text-success', n != null && n < 0 && 'text-destructive')}>{formatINR(n)}</span>;
}

function Empty({ cols, text }: { cols: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-6 text-center text-sm text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}

function PositionsTable({ rows, empty, product = true }: { rows: LivePosition[]; empty: string; product?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            {product ? <TableHead>Product</TableHead> : null}
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">LTP</TableHead>
            <TableHead className="text-right">P&amp;L</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <Empty cols={product ? 6 : 5} text={empty} />
          ) : (
            rows.map((p) => (
              <TableRow key={`${p.exchange}:${p.symbol}:${p.productType ?? ''}`}>
                <TableCell className="font-medium">
                  {p.symbol} <span className="text-xs text-muted-foreground">{p.exchange}</span>
                </TableCell>
                {product ? <TableCell>{humanize(p.productType)}</TableCell> : null}
                <TableCell className={cn('text-right tabular-nums', p.quantity < 0 && 'text-destructive')}>{formatNumber(p.quantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(p.averagePrice)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(p.lastPrice)}</TableCell>
                <TableCell className="text-right">
                  <Pnl value={p.pnl} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Funds, open positions, holdings and today's orders straight from the broker. */
export function LiveAccountCard({ a }: { a: LiveAccount }) {
  const open = (a.positions ?? []).filter((p) => p.quantity !== 0);
  const closed = (a.positions ?? []).filter((p) => p.quantity === 0);
  const dayPnl = (a.positions ?? []).reduce((s, p) => s + (p.pnl ?? 0), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {brokerLabel(a.broker)} <span className="text-sm font-normal text-muted-foreground">{a.brokerClientId}</span>
        </CardTitle>
        <CardDescription>Live from the broker · refreshes every 10 seconds</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {a.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{a.error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Available cash" value={formatINR(a.funds?.availableCash)} />
              <Stat label="Net" value={formatINR(a.funds?.net)} />
              <Stat label="Open positions" value={String(open.length)} />
              <Stat label="Today's P&L" value={<Pnl value={dayPnl} />} />
            </div>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Positions</h3>
              <PositionsTable rows={[...open, ...closed]} empty="No positions today" />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Holdings</h3>
              <PositionsTable rows={a.holdings ?? []} empty="No holdings" product={false} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Today&apos;s orders</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Avg price</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(a.orders ?? []).length === 0 ? (
                      <Empty cols={5} text="No orders today" />
                    ) : (
                      [...(a.orders ?? [])].reverse().map((o) => (
                        <TableRow key={o.brokerOrderId}>
                          <TableCell className="font-medium">
                            {o.symbol} <span className="text-xs text-muted-foreground">{o.exchange}</span>
                          </TableCell>
                          <TableCell className={o.side === 'BUY' ? 'text-success' : 'text-destructive'}>{o.side}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {o.filledQuantity}/{o.quantity}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatINR(o.averagePrice ?? o.price)}</TableCell>
                          <TableCell title={o.statusMessage}>
                            <StatusBadge value={o.status} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PaperPositionsCard({ rows, title = 'Paper positions' }: { rows: PaperPosition[]; title?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Simulated fills (PAPER_MODE / paper accounts). No real orders were placed.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Avg</TableHead>
              <TableHead className="text-right">Last</TableHead>
              <TableHead className="text-right">Realized</TableHead>
              <TableHead className="text-right">Unrealized</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <Empty cols={6} text="No paper positions yet" />
            ) : (
              rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.symbol} <span className="text-xs text-muted-foreground">{p.exchange} · {humanize(p.productType)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(p.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(p.averagePrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(p.lastPrice)}</TableCell>
                  <TableCell className="text-right">
                    <Pnl value={p.realizedPnl} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Pnl value={p.unrealizedPnl} />
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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}
