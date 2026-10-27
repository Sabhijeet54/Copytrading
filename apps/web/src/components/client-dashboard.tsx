'use client';

import { ArrowDownRight, ArrowUpRight, Building2, CheckCircle2, Pause, RefreshCw, Square, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Pnl } from '@/components/live-account';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type ClientDashboard as Data, useClientDashboard } from '@/lib/broker-api';
import { brokerLabel, formatINR } from '@/lib/format';
import { useSetTradingMode } from '@/lib/trading';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** Turn back on to show clients their licence (days left / expiry) on the dashboard. */
const SHOW_CLIENT_LICENCE = true;

/** Validated categorical palette (distinct in light and dark). */
const COLORS = ['#6425FE', '#2BC9A0', '#F5B83D', '#4F8EF7', '#E8663D', '#8E8E99', '#9B6BD6', '#22B573'];

function Badge({ tone, children }: { tone: 'ok' | 'off' | 'warn'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold',
        tone === 'ok' && 'bg-emerald-600 text-white',
        tone === 'off' && 'bg-muted text-muted-foreground',
        tone === 'warn' && 'bg-amber-400 text-black',
      )}
    >
      {children}
    </span>
  );
}

/** Donut of each strategy's share of today's absolute P&L. */
function Donut({ rows }: { rows: Data['strategies'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = rows.map((r, i) => ({ ...r, color: COLORS[i % COLORS.length]!, abs: Math.abs(r.todayPnl) })).filter((r) => r.abs > 0);
  const total = data.reduce((s, r) => s + r.abs, 0);
  if (!total) return <p className="py-16 text-center text-sm text-muted-foreground">No strategy trades today yet.</p>;
  const R = 70;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[220px_1fr]">
      <svg viewBox="0 0 200 200" className="mx-auto w-52" role="img" aria-label="Share of today's P&L by strategy">
        <g transform="rotate(-90 100 100)">
          {data.map((d, i) => {
            const len = (d.abs / total) * C;
            const el = (
              <circle
                key={d.followerId}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth={hover === i ? 34 : 28}
                strokeDasharray={`${Math.max(len - 2, 0.5)} ${C - Math.max(len - 2, 0.5)}`}
                strokeDashoffset={-acc}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="transition-[stroke-width] duration-150"
              >
                <title>{`${d.name}: ${formatINR(d.todayPnl)} (${((d.abs / total) * 100).toFixed(1)}%)`}</title>
              </circle>
            );
            acc += len;
            return el;
          })}
        </g>
        <text x="100" y="96" textAnchor="middle" className="fill-muted-foreground text-[11px]">
          {hover != null ? data[hover]!.name : 'Today'}
        </text>
        <text x="100" y="116" textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
          {hover != null ? `${((data[hover]!.abs / total) * 100).toFixed(1)}%` : `${data.length} algo${data.length > 1 ? 's' : ''}`}
        </text>
      </svg>
      <ul className="grid gap-2 text-sm">
        {data.map((d, i) => (
          <li key={d.followerId} className="flex items-center justify-between gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="truncate font-medium">{d.name}</span>
            </span>
            <span className="flex items-center gap-1">
              {d.todayPnl >= 0 ? <ArrowUpRight className="size-3.5 text-success" /> : <ArrowDownRight className="size-3.5 text-destructive" />}
              <Pnl value={d.todayPnl} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const fmtDay = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/**
 * Paper ⇄ Live switch of the SOFTWARE trading mode (asks before going live). It never connects, disconnects or
 * authenticates a broker and works without one — broker connections are managed only in Broker connection.
 */
function TradingModeSwitch({ mode, brokerReady, locked = false }: { mode: 'PAPER' | 'LIVE'; brokerReady: boolean; locked?: boolean }) {
  const setMode = useSetTradingMode();
  const [confirmLive, setConfirmLive] = useState(false);
  const live = mode === 'LIVE';
  const flip = () => {
    if (live) setMode.mutate('PAPER', { onSuccess: () => toast.success('Switched to PAPER — strategy trades are now simulated'), onError: (e) => toast.error(e.message) });
    else setConfirmLive(true);
  };
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Trading mode</span>
        <button
          type="button"
          role="switch"
          aria-checked={live}
          aria-label="Live trading"
          onClick={flip}
          disabled={setMode.isPending || locked}
          title={live ? 'Switch to paper trading' : 'Switch to live trading'}
          className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted disabled:opacity-60"
        >
          <span className={cn(!live && 'font-semibold text-foreground')}>Paper</span>
          <span className={cn('relative inline-block h-5 w-9 rounded-full transition-colors', live ? 'bg-emerald-600' : 'bg-muted-foreground/40')}>
            <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', live ? 'left-[18px]' : 'left-0.5')} />
          </span>
          <span className={cn(live && 'font-semibold text-success')}>Live</span>
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {live
          ? brokerReady
            ? 'Strategy trades are recorded in the software and sent to your connected broker as real orders.'
            : 'Strategy trades are recorded in the software, but NOT sent to a broker until a valid broker connection exists.'
          : 'Strategy trades are simulated in the software — no broker needed, no real orders.'}
      </p>
      <p className="text-[11px] text-muted-foreground">Switching mode never connects or disconnects your broker.</p>
      <Dialog open={confirmLive} onOpenChange={setConfirmLive}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch to LIVE trading?</DialogTitle>
            <DialogDescription>
              From the next strategy trade, trades are recorded as Live trades
              {brokerReady ? ' and placed as REAL orders in your connected broker account with real money.' : '. No broker is connected right now, so no order will be sent until you connect one in Broker connection.'}{' '}
              Any open paper trades are closed now in the software at the current price (no broker order).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmLive(false)}>
              Cancel
            </Button>
            <Button
              disabled={setMode.isPending}
              onClick={() =>
                setMode.mutate('LIVE', {
                  onSuccess: (r) => (toast.success(r.paperClosed ? `LIVE mode is ON — ${r.paperClosed} open paper trade(s) closed` : 'LIVE mode is ON'), setConfirmLive(false)),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Go live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ClientDashboard() {
  const q = useClientDashboard();
  const d = q.data;
  const sorted = useMemo(() => [...(d?.strategies ?? [])].sort((a, b) => b.todayPnl - a.todayPnl), [d]);

  if (q.isLoading) {
    return (
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    );
  }
  if (!d) return null;
  const up = d.todayPnl >= 0;

  return (
    <div className="mb-6 grid gap-4">
      {d.licence.active === false ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <strong>Your licence has expired.</strong> Auto trading (paper and live) and strategy connect are blocked. Contact your master to renew.
        </div>
      ) : null}
      <div className={cn("fox-tiles grid gap-4 sm:grid-cols-2", "xl:grid-cols-3")}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trading mode</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex items-center gap-2">
              {d.tradingMode === 'LIVE' ? <Badge tone="ok">LIVE</Badge> : <Badge tone="warn">PAPER</Badge>}
              <span className="text-xs text-muted-foreground">software mode</span>
            </div>
            <TradingModeSwitch mode={d.tradingMode} brokerReady={!!d.broker?.connected} locked={d.licence.active === false || (!!d.licence.demo && d.tradingMode !== 'LIVE')} />
            {d.licence.demo ? <p className="text-xs text-amber-700">Demo licence — paper trading only.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Strategy P&amp;L today</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div>
              <p className={cn('text-3xl font-semibold tabular-nums', up ? 'text-success' : 'text-destructive')}>
                {up ? '+' : ''}
                {formatINR(d.todayPnl)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Software-level ({d.tradingMode === 'LIVE' ? 'Live' : 'Paper'} mode) · realized <Pnl value={d.software.realizedPnl} /> · unrealized <Pnl value={d.software.unrealizedPnl} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {d.software.trades} trade{d.software.trades === 1 ? '' : 's'} · {d.software.open} open · {d.software.closed} closed ·{' '}
                <Link href="/portfolio/positions" className="font-medium text-primary hover:underline">
                  positions
                </Link>
              </p>
            </div>
            {up ? <ArrowUpRight className="size-8 text-success" /> : <ArrowDownRight className="size-8 text-destructive" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Broker-executed P&amp;L</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p className="text-2xl font-semibold tabular-nums">
              <Pnl value={d.brokerPnl} />
            </p>
            <p className="text-xs text-muted-foreground">
              Actual Demat executions only (filled broker orders). Paper and not-executed trades are never included.{' '}
              <Link href="/portfolio/positions?tab=orders" className="font-medium text-primary hover:underline">
                Orders
              </Link>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Broker status</CardTitle>
          </CardHeader>
          {/* Display only — broker login / token generation happens in Broker connection, never here. */}
          <CardContent className="grid gap-3 text-sm">
            {d.broker ? (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <Building2 className="size-5 text-primary" /> {brokerLabel(d.broker.broker)}
                </span>
                {d.broker.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">{d.broker.status === 'EXPIRED' ? 'Expired' : 'Not connected'}</Badge>}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">No broker connected</span>
                <Badge tone="off">None</Badge>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {d.broker?.connected
                ? d.tradingMode === 'LIVE'
                  ? 'Live strategy trades are sent to this broker.'
                  : 'Not used in Paper mode.'
                : d.tradingMode === 'LIVE'
                  ? 'Live strategy trades are recorded but not sent to any broker.'
                  : 'Not needed for paper trading.'}{' '}
              Manage it in{' '}
              <Link href="/broker" className="font-medium text-primary hover:underline">
                Broker connection
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Strategies</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-medium">Total</span>
              <span className="text-lg font-semibold tabular-nums">{d.subscriptions.total}</span>
            </div>
            <div className="flex items-center justify-between gap-2 tabular-nums">
              <span className="flex items-center gap-1" title="Auto trading ON">
                <CheckCircle2 className="size-4 text-success" /> {d.subscriptions.on}
              </span>
              <span className="flex items-center gap-1" title="Paused">
                <Pause className="size-4 text-warning" /> {d.subscriptions.paused}
              </span>
              <span className="flex items-center gap-1" title="Auto trading OFF">
                <Square className="size-4 text-destructive" /> {d.subscriptions.off}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Licence card hidden from clients for now (SHOW_CLIENT_LICENCE) — admin still manages licences. */}
        {SHOW_CLIENT_LICENCE ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Licence</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {d.licence.expiresAt ? (
              <>
                <p className="flex items-center gap-2">
                  <span className={cn('text-2xl font-semibold tabular-nums', d.licence.active ? 'text-success' : 'text-destructive')}>{d.licence.remainingDays}</span> days left
                  {d.licence.active ? <Badge tone="ok">{d.licence.demo ? 'Demo · paper only' : 'Active'}</Badge> : <Badge tone="warn">Expired</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.licence.assignedAt ? (
                    <>
                      From <span className="font-medium text-foreground">{fmtDay(d.licence.assignedAt)}</span>{' '}
                    </>
                  ) : null}
                  till <span className="font-medium text-foreground">{fmtDay(d.licence.expiresAt)}</span>
                </p>
                {!d.licence.active ? <p className="text-xs text-destructive">Auto trading is stopped — contact your master to renew.</p> : null}
              </>
            ) : (
              <>
                <p className="font-medium">{d.licence.demo ? 'Demo — paper trading only' : 'No licence assigned'}</p>
                <p className="text-xs text-muted-foreground">Contact your master to activate your subscription.</p>
              </>
            )}
          </CardContent>
        </Card>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Trade statistics</CardTitle>
            <Button size="sm" variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={cn(q.isFetching && 'animate-spin')} /> Refresh
            </Button>
          </CardHeader>
          <CardContent>
            <Donut rows={d.strategies} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s strategy performance</CardTitle>
            <p className="text-sm text-muted-foreground">
              Software P&amp;L: <span className="font-semibold"><Pnl value={d.todayPnl} /></span> · Broker-executed: <span className="font-semibold"><Pnl value={d.brokerPnl} /></span>
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Algo name</TableHead>
                  <TableHead>Allocation</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Software P&amp;L</TableHead>
                  <TableHead className="text-right">Broker-executed</TableHead>
                  <TableHead className="pr-6">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No strategy assigned to you yet — contact your admin.
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((s) => (
                    <TableRow key={s.followerId}>
                      <TableCell className="pl-6 font-medium">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{s.allocation}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.todayTrades}</TableCell>
                      <TableCell className="text-right font-medium">
                        <Pnl value={s.todayPnl} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <Pnl value={s.brokerPnl} />
                      </TableCell>
                      <TableCell className="pr-6">
                        {s.copyStatus === 'ON' ? (
                          <Badge tone="ok">
                            <CheckCircle2 className="size-3" /> Active
                          </Badge>
                        ) : s.copyStatus === 'PAUSED' ? (
                          <Badge tone="warn">
                            <Pause className="size-3" /> Paused
                          </Badge>
                        ) : (
                          <Badge tone="off">
                            <XCircle className="size-3" /> Off
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
