'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { brokerLabel, formatDateTime, formatINR, formatNumber, humanize } from '@/lib/format';
import { type LiveAccount, type LivePosition, type LtpMap, type PaperPosition, useExitPosition, useExitSignalBook, useLtps } from '@/lib/trading';
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

/** Master's signal book: exiting a row squares off that instrument's signals for the master and all clients. */
function useBookExit() {
  const m = useExitSignalBook();
  const exit = (_accountId: string, p: { exchange: string; symbol: string; productType?: string }) =>
    m.mutate(
      { exchange: p.exchange, symbol: p.symbol, productType: p.productType ?? 'INTRADAY' },
      {
        onSuccess: (r) => toast.success(`${p.symbol} exited for you and all clients${r.signalsClosed ? ` · ${r.signalsClosed} signal(s) closed` : ''}`),
        onError: (err) => toast.error(err.message),
      },
    );
  return { exit, pending: m.isPending, pendingVars: m.variables ? { accountId: '', ...m.variables } : undefined };
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

function useAccountLtps(a: LiveAccount) {
  const open = (a.positions ?? []).filter((p) => p.quantity !== 0);
  return useLtps([...open, ...(a.holdings ?? [])].map((p) => keyOf(p.exchange, p.symbol))).data;
}

function dayPnlOf(a: LiveAccount, ltps?: LtpMap) {
  return (a.positions ?? []).reduce((s, p) => {
    const ltp = liveLtp(ltps, p.exchange, p.symbol, p.lastPrice);
    return s + (p.pnl != null && p.lastPrice != null && ltp != null ? p.pnl + (ltp - p.lastPrice) * p.quantity : (p.pnl ?? 0));
  }, 0);
}

function AccountTitle({ a, children }: { a: LiveAccount; children?: React.ReactNode }) {
  return (
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2">
        {brokerLabel(a.broker)} <span className="text-sm font-normal text-muted-foreground">{a.brokerClientId}</span>
      </CardTitle>
      <CardDescription>{children ?? 'Live from the broker · prices update every 2 s from the market feed'}</CardDescription>
    </CardHeader>
  );
}

function AccountError({ a }: { a: LiveAccount }) {
  return <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{a.error}</p>;
}

/**
 * Today's broker positions — open ones first, then positions closed today (qty 0) with their realized P&L,
 * the same way the broker app shows them. Holdings are NOT here (see HoldingsCard).
 */
export function LivePositionsCard({ a, canExit = false, clientUserId }: { a: LiveAccount; canExit?: boolean; clientUserId?: string }) {
  const open = (a.positions ?? []).filter((p) => p.quantity !== 0);
  const closed = (a.positions ?? []).filter((p) => p.quantity === 0);
  const ltps = useAccountLtps(a);
  const dayPnl = dayPnlOf(a, ltps);
  const { exit, pending, pendingVars } = useExit(clientUserId);
  const exiting = pending && pendingVars ? `${pendingVars.exchange}:${pendingVars.symbol}:${pendingVars.productType}` : null;
  return (
    <Card>
      <AccountTitle a={a} />
      <CardContent className="grid gap-4">
        {a.error ? (
          <AccountError a={a} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Available cash" value={formatINR(a.funds?.availableCash)} />
              <Stat label="Open positions" value={String(open.length)} />
              <Stat label="Closed today" value={String(closed.length)} />
              <Stat label="Positions P&L" value={<Pnl value={dayPnl} />} />
            </div>
            <PositionsTable
              rows={[...open, ...closed]}
              empty="No positions today"
              ltps={ltps}
              onExit={canExit ? (p) => exit(a.accountId, p) : undefined}
              exiting={exiting}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Long-term holdings (delivery stock bought earlier) — kept apart from today's positions. */
export function HoldingsCard({ a }: { a: LiveAccount }) {
  const ltps = useAccountLtps(a);
  const rows = a.holdings ?? [];
  const invested = rows.reduce((s, h) => s + h.averagePrice * h.quantity, 0);
  const current = rows.reduce((s, h) => s + (liveLtp(ltps, h.exchange, h.symbol, h.lastPrice) ?? h.averagePrice) * h.quantity, 0);
  return (
    <Card>
      <AccountTitle a={a}>Holdings in your demat account (bought on earlier days)</AccountTitle>
      <CardContent className="grid gap-4">
        {a.error ? (
          <AccountError a={a} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Invested" value={formatINR(invested)} />
              <Stat label="Current value" value={formatINR(current)} />
              <Stat label="Total P&L" value={<Pnl value={current - invested} />} />
            </div>
            <PositionsTable rows={rows} empty="No holdings" product={false} ltps={ltps} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Today's orders in the broker's order book. */
export function BrokerOrdersCard({ a }: { a: LiveAccount }) {
  return (
    <Card>
      <AccountTitle a={a}>Today&apos;s orders in your broker account</AccountTitle>
      <CardContent>
        {a.error ? (
          <AccountError a={a} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(a.orders ?? []).length === 0 ? (
                  <Empty cols={6} text="No orders today" />
                ) : (
                  [...(a.orders ?? [])].reverse().map((o) => (
                    <TableRow key={o.brokerOrderId}>
                      <TableCell className="whitespace-nowrap text-xs">{o.timestamp ? formatDateTime(o.timestamp) : '—'}</TableCell>
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
        )}
      </CardContent>
    </Card>
  );
}

/** Funds, positions, holdings and today's orders straight from the broker, as three tabs. */
export function LiveAccountCard({ a, canExit = false, clientUserId }: { a: LiveAccount; canExit?: boolean; clientUserId?: string }) {
  const [tab, setTab] = useState<'positions' | 'holdings' | 'orders'>('positions');
  return (
    <div className="grid gap-2">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'positions', label: `Positions (${(a.positions ?? []).length})` },
          { value: 'holdings', label: `Holdings (${(a.holdings ?? []).length})` },
          { value: 'orders', label: `Orders (${(a.orders ?? []).length})` },
        ]}
      />
      {tab === 'positions' ? <LivePositionsCard a={a} canExit={canExit} clientUserId={clientUserId} /> : tab === 'holdings' ? <HoldingsCard a={a} /> : <BrokerOrdersCard a={a} />}
    </div>
  );
}

/** Simple segmented tabs. */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex w-fit flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
            value === t.value && 'bg-background text-foreground shadow-sm',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PaperPositionsCard({
  rows,
  title = 'Paper positions',
  canExit = false,
  clientUserId,
  signalBook = false,
  inlineClosed = false,
}: {
  rows: PaperPosition[];
  title?: string;
  canExit?: boolean;
  clientUserId?: string;
  /** Master's own virtual book: Exit squares off the instrument's signals for master + all clients. */
  signalBook?: boolean;
  /** Show positions closed today right in the table (qty 0 + realized P&L) like the broker app does. */
  inlineClosed?: boolean;
}) {
  const open = inlineClosed ? rows : rows.filter((p) => p.quantity !== 0);
  const closed = inlineClosed ? [] : rows.filter((p) => p.quantity === 0);
  const [showClosed, setShowClosed] = useState(false);
  const ltps = useLtps(open.map((p) => keyOf(p.exchange, p.symbol))).data;
  const selfExit = useExit(clientUserId);
  const bookExit = useBookExit();
  const { exit, pending, pendingVars } = signalBook ? bookExit : selfExit;
  const closedPnl = closed.reduce((s, p) => s + Number(p.realizedPnl), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {inlineClosed
            ? 'Paper trading — simulated fills, no real orders.'
            : 'Simulated fills (PAPER_MODE / paper accounts). No real orders were placed. Exited positions move to Closed history.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 overflow-x-auto">
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
            {open.length === 0 ? (
              <Empty cols={canExit ? 7 : 6} text={inlineClosed ? 'No positions today' : 'No open positions'} />
            ) : (
              open.map((p) => {
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
        {closed.length > 0 ? (
          <section>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
              aria-expanded={showClosed}
              onClick={() => setShowClosed((v) => !v)}
            >
              <span className="font-medium">
                Closed positions ({closed.length}) {showClosed ? '▴' : '▾'}
              </span>
              <span>
                Realized <Pnl value={closedPnl} />
              </span>
            </button>
            {showClosed ? (
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Last exit</TableHead>
                    <TableHead>Closed at</TableHead>
                    <TableHead className="text-right">Realized P&amp;L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closed.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.symbol} <span className="text-xs text-muted-foreground">{p.exchange} · {humanize(p.productType)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(p.lastPrice)}</TableCell>
                      <TableCell className="text-xs">{p.updatedAt ? formatDateTime(p.updatedAt) : '—'}</TableCell>
                      <TableCell className="text-right">
                        <Pnl value={p.realizedPnl} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </section>
        ) : null}
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
