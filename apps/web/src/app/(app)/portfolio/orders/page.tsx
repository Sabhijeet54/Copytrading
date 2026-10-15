'use client';

import { BrokerOrdersCard } from '@/components/live-account';
import { CopyOrdersTable } from '@/components/master-client-detail';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePortfolio } from '@/lib/trading';

/** Client: today's copied trades + today's broker order book. History starts empty every trading day. */
export default function OrdersPage() {
  const portfolio = usePortfolio();
  const p = portfolio.data;
  return (
    <>
      <PageHeader title="Today's orders" description="Only today's orders are shown — the list starts fresh every trading day." />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Copied trades today</CardTitle>
            <CardDescription>Every master trade copied (or skipped) for your account today.</CardDescription>
          </CardHeader>
          <CardContent>
            <CopyOrdersTable rows={p?.copyOrders ?? []} empty={portfolio.isLoading ? 'Loading…' : 'No copied trades today'} />
          </CardContent>
        </Card>
        {p?.live.map((a) => <BrokerOrdersCard key={a.accountId} a={a} />)}
      </div>
    </>
  );
}
