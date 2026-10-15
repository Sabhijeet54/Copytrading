'use client';

import Link from 'next/link';
import { HoldingsCard } from '@/components/live-account';
import { PageHeader } from '@/components/page-header';
import { usePortfolio } from '@/lib/trading';

/** Client: long-term holdings from the broker (bought on earlier days) — separate from today's positions. */
export default function HoldingsPage() {
  const portfolio = usePortfolio();
  const p = portfolio.data;
  return (
    <>
      <PageHeader title="Holdings" description="Shares held in your demat account from earlier days. Today's trades are on the Positions page." />
      <div className="grid gap-4">
        {portfolio.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {p?.live.map((a) => <HoldingsCard key={a.accountId} a={a} />)}
        {p && p.live.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect your broker on the{' '}
            <Link className="underline" href="/broker">
              Broker connection
            </Link>{' '}
            page to see your holdings.
          </p>
        ) : null}
      </div>
    </>
  );
}
