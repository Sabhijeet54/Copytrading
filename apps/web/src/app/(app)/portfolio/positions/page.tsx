'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BrokerOrdersCard, HoldingsCard, LivePositionsCard, Pnl, Tabs } from '@/components/live-account';
import { BrokerOrdersTable } from '@/components/broker-orders-table';
import { PageHeader } from '@/components/page-header';
import { TradeBookCard } from '@/components/trade-book';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useExitAllMine, usePortfolio, useTradeBook } from '@/lib/trading';

type Tab = 'positions' | 'holdings' | 'orders';

/** Client portfolio: Positions · Holdings · Orders in one page (tabs). */
export default function PositionsPage() {
  const portfolio = usePortfolio();
  const book = useTradeBook();
  const exitAll = useExitAllMine();
  const [exitOpen, setExitOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('positions');
  // /portfolio/positions?tab=holdings opens that tab (old Holdings / Orders links land here).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'holdings' || t === 'orders') setTab(t);
  }, []);
  const p = portfolio.data;
  const nPositions = book.data?.rows.length ?? 0;
  // Orders count = orders today (the same list the Orders tab shows).
  const nHoldings = (p?.live ?? []).reduce((a, x) => a + (x.holdings?.length ?? 0), 0);
  const nOrders = p?.copyOrders.length ?? 0;

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Today's positions, your holdings and today's orders. Closed positions stay listed with their P&L until the day ends."
        actions={
          <Button variant="destructive" size="sm" onClick={() => setExitOpen(true)}>
            Exit all &amp; stop auto trading
          </Button>
        }
      />
      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exit all positions and stop auto trading?</DialogTitle>
            <DialogDescription>All your strategy subscriptions are turned OFF and every open position in your trading account is closed at MARKET.</DialogDescription>
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
                  onSuccess: (r) => (toast.success(`Auto trading stopped · ${r.orders} exit order(s)${r.failed ? `, ${r.failed} failed` : ''}`), setExitOpen(false)),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              {exitAll.isPending ? 'Exiting…' : 'Exit all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 [&>*]:min-w-0">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'positions', label: `Positions (${nPositions})` },
            { value: 'holdings', label: `Holdings (${nHoldings})` },
            { value: 'orders', label: `Orders (${nOrders})` },
          ]}
        />

        {tab === 'positions' ? (
          <>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-6 pt-6">
                <div className="flex flex-wrap gap-8">
                  <div>
                    <p className="text-xs text-muted-foreground">Strategy P&amp;L today (software-level)</p>
                    <p className="text-2xl font-semibold">
                      <Pnl value={book.data?.software.totalPnl ?? p?.todayPnl ?? 0} />
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Realized <Pnl value={book.data?.software.realizedPnl ?? 0} /> · Unrealized <Pnl value={book.data?.software.unrealizedPnl ?? 0} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Broker-executed P&amp;L (Demat)</p>
                    <p className="text-2xl font-semibold">
                      <Pnl value={book.data?.brokerExecuted.totalPnl ?? p?.brokerPnl ?? 0} />
                    </p>
                    <p className="text-[11px] text-muted-foreground">Actual broker fills only — kept separate from strategy P&amp;L.</p>
                  </div>
                </div>
                {p?.paperMode ? (
                  <p className="max-w-md rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <strong>Paper mode</strong> — strategy trades are simulated in the software; no orders reach a broker.
                  </p>
                ) : (
                  <p className="max-w-md rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs">
                    <strong>Live mode</strong> — strategy trades are listed here even when a broker order is rejected or not sent. Check the{' '}
                    <button type="button" className="font-medium text-primary underline" onClick={() => setTab('orders')}>
                      Orders
                    </button>{' '}
                    tab for actual broker execution.
                  </p>
                )}
              </CardContent>
            </Card>
            <TradeBookCard />
            {portfolio.isLoading ? <p className="text-sm text-muted-foreground">Loading live data…</p> : null}
            {/* Actual Demat positions from the broker (live trading only; in paper mode the broker has no strategy positions). */}
            {p?.live.filter((a) => !p.paperMode || (a.positions ?? []).length > 0).map((a) => <LivePositionsCard key={a.accountId} a={a} />)}
          </>
        ) : null}

        {tab === 'holdings' ? (
          <>
            {portfolio.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
            {p?.live.map((a) => <HoldingsCard key={a.accountId} a={a} />)}
          </>
        ) : null}

        {tab === 'orders' ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Broker orders today</CardTitle>
                <CardDescription>
                  Actual broker execution of every strategy trade: submitted, open, executed, partially filled, rejected (with the broker&apos;s reason), cancelled, failed — or not
                  sent because no valid broker connection was available. Paper trades are never sent to a broker. Match a row to Positions by Trade ID.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BrokerOrdersTable rows={p?.copyOrders ?? []} empty={portfolio.isLoading ? 'Loading…' : 'No strategy orders today'} />
              </CardContent>
            </Card>
            {p?.live.map((a) => <BrokerOrdersCard key={a.accountId} a={a} />)}
          </>
        ) : null}

        {p && p.live.length === 0 && tab !== 'orders' ? (
          <p className="text-sm text-muted-foreground">
            No broker connected — strategy trades are still recorded above. Connect a broker on the{' '}
            <Link className="underline" href="/broker">
              Broker connection
            </Link>{' '}
            page to see your Demat positions and holdings.
          </p>
        ) : null}
      </div>
    </>
  );
}
