'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BrokerName, OrderStatus } from '@ctp/types';
import { EnumSelect } from '@/components/enum-select';
import { Field, FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { TableEmpty, TableError, TableLoading } from '@/components/table-states';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { brokerLabel, formatDateTime, formatNumber } from '@/lib/format';
import { useAdminCopyOrders } from '@/lib/queries';
import { istDayEndExclusive, istDayStart, useListState } from '@/lib/use-list-state';

const COLS = 10;

function CopyOrders() {
  const initialMasterTrade = useSearchParams().get('masterTradeId') ?? '';
  const list = useListState({ broker: '', status: '', masterTradeId: initialMasterTrade, from: '', to: '' });
  const { from, to, ...rest } = list.params as Record<string, string | number>;
  const q = useAdminCopyOrders({ ...rest, from: istDayStart(String(from ?? '')), to: istDayEndExclusive(String(to ?? '')) });

  return (
    <Card className="overflow-hidden">
      <FilterBar onReset={list.reset} active={list.active}>
        <Field label="Master trade ID" className="grid w-56 gap-1.5">
          <Input value={list.filters.masterTradeId} onChange={(e) => list.setFilter('masterTradeId', e.target.value.trim())} />
        </Field>
        <Field label="Broker">
          <EnumSelect value={list.filters.broker} onChange={(v) => list.setFilter('broker', v)} options={Object.values(BrokerName).filter((b) => b !== 'ZERODHA')} labels={brokerLabel} />
        </Field>
        <Field label="Status">
          <EnumSelect value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={Object.values(OrderStatus)} />
        </Field>
        <Field label="From">
          <Input type="date" value={list.filters.from} onChange={(e) => list.setFilter('from', e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={list.filters.to} onChange={(e) => list.setFilter('to', e.target.value)} />
        </Field>
      </FilterBar>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Master trade</TableHead>
            <TableHead>Follower</TableHead>
            <TableHead>Broker</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Side</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Follower order ID</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Timestamp</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.isLoading ? (
            <TableLoading cols={COLS} />
          ) : q.error ? (
            <TableError cols={COLS} error={q.error} />
          ) : !q.data?.items.length ? (
            <TableEmpty cols={COLS} message="No copy orders match these filters." />
          ) : (
            q.data.items.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-mono text-xs">
                  <button className="hover:underline" onClick={() => list.setFilter('masterTradeId', o.masterTradeId)} title="Filter by this master trade">
                    #{o.masterTradeId.slice(-8)}
                  </button>
                </TableCell>
                <TableCell>
                  <Link href={`/admin/users/${o.followerUserId}`} className="font-medium hover:underline">
                    {o.followerName}
                  </Link>
                </TableCell>
                <TableCell>{brokerLabel(o.broker)}</TableCell>
                <TableCell>
                  <span className="font-medium">{o.symbol}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{o.exchange}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge value={o.side} />
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatNumber(o.filledQuantity)} / {formatNumber(o.quantity)}
                </TableCell>
                <TableCell>
                  <StatusBadge value={o.status} />
                </TableCell>
                <TableCell className="font-mono text-xs">{o.brokerOrderId ?? '—'}</TableCell>
                <TableCell className="max-w-56 text-xs text-destructive">{o.errorMessage ?? ''}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(o.createdAt)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {q.data ? <Pagination page={list.page} pageSize={list.pageSize} total={q.data.total} onPage={list.setPage} /> : null}
    </Card>
  );
}

export default function AdminCopyOrdersPage() {
  return (
    <>
      <PageHeader title="Copy orders" description="Follower orders created by the copy engine, with their broker status and any failure reason." />
      <Suspense>
        <CopyOrders />
      </Suspense>
    </>
  );
}
