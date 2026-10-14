'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { brokerLabel, formatINR, formatNumber, humanize } from '@/lib/format';
import { type LiveAccount, type LivePosition, type LtpMap, type PaperPosition, useExitPosition, useLtps } from '@/lib/trading';
import { cn } from '@/lib/utils';

export function Pnl({ value }: { value: number | string | null | undefined }) {
  const n = value == null ? null : Number(value);
  return <span className={cn('tabular-nums', n != null && n > 0 && 'text-success', n != null && n < 0 && 'text-destructive')}>{formatINR(n)}</span>;
}

const keyOf = (exchange: string, symbol: string) => `${exchange}:${symbol}`.toUpperCase();

/** Live LTP for a row: the 2-second price cache wins over the (10-second) broker value. Flashes green/red on change. */
function LivePrice({ value }: { value: number | null }) {
  const prev = useRef<number | null>(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setDir(value > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setDir(null), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return (
    <span
      className={cn(
        'rounded px-1 tabular-nums transition-colors duration-500',
        dir === 'up' && 'bg-emerald-500/20 text-success',
        dir === 'down' && 'bg-red-500/20 text-destructive',
      )}
    >
      {formatINR(value)}
    </span>
  );
}

function liveLtp(ltps: LtpMap | undefined, exchange: string, symbol: string, fallback: number | null): number | null {
  return ltps?.[keyOf(exchange, symbol)]?.ltp ?? fallback;
}

/** Two-step exit button (click → confirm within 4 s), MARKET order for the full position. */
export function ExitButton({ label = 'Exit', onConfirm, pending }: { label?: string; onConfirm: () => void; pending?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      size="sm"
      variant={armed ? 'destructive' : 'outline'}
      className="h-7 px-2 text-xs"
      disabled={pending}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      title={armed ? 'Click again to confirm' : label}
    >
      {pending ? 'Working…' : armed ? `Confirm ${label.toLowerCase()}` : label}
    </Button>
  );
}

function useExit(clientUserId?: string) {
  const m = useExitPosition(clientUserId);
  const exit = (accountId: string, p: { exchange: string; symbol: string; productType?: string }) =>
    m.mutate(
      { accountId, exchange: p.exchange, symbol: p.symbol, productType: p.productType ?? 'INTRADAY' },
      {
        onSuccess: (r) => toast.success(`Exit order placed: ${p.symbol} × ${r.quantity}`),
        onError: (err) => toast.error(err.message),
      },
    );
  return { exit, pending: m.isPending, pendingVars: m.variables };
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

function PositionsTable({
  rows,
  empty,
  product = true,
  ltps,
  onExit,
  exiting,
}: {
  rows: LivePosition[];
  empty: string;
  product?: boolean;
  ltps?: LtpMap;
  onExit?: (p: LivePosition) => void;
  exiting?: string | null;
}) {
  const cols = (product ? 6 : 5) + (onExit ? 1 : 0);
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
            {onExit ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <Empty cols={cols} text={empty} />
          ) : (
            rows.map((p) => {
              const ltp = liveLtp(ltps, p.exchange, p.symbol, p.lastPrice);
              // Move broker P&L by the price change since the broker's last price (open quantity only).
              const pnl = p.pnl != null && p.lastPrice != null && ltp != null ? p.pnl + (ltp - p.lastPrice) * p.quantity : p.pnl;
              const rowKey = `${p.exchange}:${p.symbol}:${p.productType ?? ''}`;
              return (
              <TableRow key={`${p.exchange}:${p.symbol}:${p.productType ?? ''}`}>
                <TableCell className="font-medium">
                  {p.symbol} <span className="text-xs text-muted-foreground">{p.exchange}</span>
                </TableCell>
                {product ? <TableCell>{humanize(p.productType)}</TableCell> : null}
                <TableCell className={cn('text-right tabular-nums', p.quantity < 0 && 'text-destructive')}>{formatNumber(p.quantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(p.averagePrice)}</TableCell>
                <TableCell className="text-right">
                  <LivePrice value={ltp} />
                </TableCell>
                <TableCell className="text-right">
                  <Pnl value={pnl} />
                </TableCell>
                {onExit ? (
                  <TableCell className="text-right">
                    {p.quantity !== 0 ? <ExitButton pending={exiting === rowKey} onConfirm={() => onExit(p)} /> : null}
                  </TableCell>
                ) : null}
              </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Funds, open positions, holdings and today's orders straight from the broker. */
export function LiveAccountCard({ a, canExit = false, clientUserId }: { a: LiveAccount; canExit?: boolean; clientUserId?: string }) {
  const open = (a.positions ?? []).filter((p) => p.quantity !== 0);
  const closed = (a.positions ?? []).filter((p) => p.quantity === 0);
  const ltps = useLtps([...open, ...(a.holdings ?? [])].map((p) => keyOf(p.exchange, p.symbol))).data;
  const dayPnl = (a.positions ?? []).reduce((s, p) => {
    const ltp = liveLtp(ltps, p.exchange, p.symbol, p.lastPrice);
    return s + (p.pnl != null && p.lastPrice != null && ltp != null ? p.pnl + (ltp - p.lastPrice) * p.quantity : (p.pnl ?? 0));
  }, 0);
  const { exit, pending, pendingVars } = useExit(clientUserId);
  const exiting = pending && pendingVars ? `${pendingVars.exchange}:${pendingVars.symbol}:${pendingVars.productType}` : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {brokerLabel(a.broker)} <span className="text-sm font-normal text-muted-foreground">{a.brokerClientId}</span>
        </CardTitle>
        <CardDescription>Live from the broker · prices update every 2 s from the market feed</CardDescription>
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
              <PositionsTable
                rows={[...open, ...closed]}
                empty="No positions today"
                ltps={ltps}
                onExit={canExit ? (p) => exit(a.accountId, p) : undefined}
                exiting={exiting}
              />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Holdings</h3>
              <PositionsTable rows={a.holdings ?? []} empty="No holdings" product={false} ltps={ltps} />
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

export function PaperPositionsCard({
  rows,
  title = 'Paper positions',
  canExit = false,
  clientUserId,
}: {
  rows: PaperPosition[];
  title?: string;
  canExit?: boolean;
  clientUserId?: string;
}) {
  const ltps = useLtps(rows.filter((p) => p.quantity !== 0).map((p) => keyOf(p.exchange, p.symbol))).data;
  const { exit, pending, pendingVars } = useExit(clientUserId);
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
              {canExit ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <Empty cols={canExit ? 7 : 6} text="No paper positions yet" />
            ) : (
              rows.map((p) => {
                const ltp = liveLtp(ltps, p.exchange, p.symbol, p.lastPrice == null ? null : Number(p.lastPrice));
                const unrealized = p.quantity !== 0 && ltp != null ? p.quantity * (ltp - Number(p.averagePrice)) : Number(p.unrealizedPnl);
                const isExiting = pending && pendingVars?.symbol === p.symbol && pendingVars?.exchange === p.exchange && pendingVars?.productType === p.productType;
                return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.symbol} <span className="text-xs text-muted-foreground">{p.exchange} · {humanize(p.productType)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(p.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(p.averagePrice)}</TableCell>
                  <TableCell className="text-right">
                    <LivePrice value={ltp} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Pnl value={p.realizedPnl} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Pnl value={unrealized} />
                  </TableCell>
                  {canExit ? (
                    <TableCell className="text-right">
                      {p.quantity !== 0 ? <ExitButton pending={isExiting} onConfirm={() => exit(p.brokerAccountId, p)} /> : null}
                    </TableCell>
                  ) : null}
                </TableRow>
                );
              })
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
