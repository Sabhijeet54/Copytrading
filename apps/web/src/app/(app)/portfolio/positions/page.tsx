'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { LivePositionsCard, PaperPositionsCard, Pnl } from '@/components/live-account';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useExitAllMine, usePortfolio } from '@/lib/trading';

/** Client: today's positions only (open + closed today). Holdings live on their own page. */
export default function PositionsPage() {
  const portfolio = usePortfolio();
  const exitAll = useExitAllMine();
  const [exitOpen, setExitOpen] = useState(false);
  const p = portfolio.data;

  return (
    <>
      <PageHeader
        title="Positions"
        description="Today's positions from copied trades. Closed positions stay listed with their P&L until the day ends."
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

      <div className="grid gap-4">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-xs text-muted-foreground">Today&apos;s P&amp;L (all copied trades)</p>
              <p className="text-2xl font-semibold">
                <Pnl value={p?.todayPnl ?? 0} />
              </p>
            </div>
            {p?.paperMode ? (
              <p className="max-w-md rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <strong>Paper mode</strong> — copied trades are simulated; they appear under Paper positions, not in your broker.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {portfolio.isLoading ? <p className="text-sm text-muted-foreground">Loading live data…</p> : null}
        {p && p.paperPositions.length > 0 ? <PaperPositionsCard rows={p.paperPositions} inlineClosed /> : null}
        {p?.live.map((a) => <LivePositionsCard key={a.accountId} a={a} />)}
        {p && p.live.length === 0 && p.paperPositions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No positions today. Connect your broker on the{' '}
            <Link className="underline" href="/broker">
              Broker connection
            </Link>{' '}
            page to see live positions.
          </p>
        ) : null}
      </div>
    </>
  );
}
