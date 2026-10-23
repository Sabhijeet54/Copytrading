'use client';

import Link from 'next/link';
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
import { brokerLabel, formatDateTime, formatINR, formatNumber } from '@/lib/format';
import { useAdminMasterTrades } from '@/lib/queries';
import { istDayEndExclusive, istDayStart, useListState } from '@/lib/use-list-state';

const COLS = 10;

export default function AdminMasterTradesPage() {
  const list = useListState({ broker: '', status: '', symbol: '', from: '', to: '' });
  const { from, to, ...rest } = list.params as Record<string, string | number>;
  const q = useAdminMasterTrades({ ...rest, from: istDayStart(String(from ?? '')), to: istDayEndExclusive(String(to ?? '')) });

  return (
    <>
      <PageHeader title="Master trades" description="Executions detected on master broker accounts and normalised by the platform." />
      <Card className="overflow-hidden">
        <FilterBar onReset={list.reset} active={list.active}>
          <Field label="Symbol">
            <Input placeholder="e.g. NIFTY" value={list.filters.symbol} onChange={(e) => list.setFilter('symbol', e.target.value)} />
          </Field>
          <Field label="Broker">
            <EnumSelect value={list.filters.broker} onChange={(v) => list.setFilter('broker', v)} options={Object.values(BrokerName).filter((b) => b !== 'ZERODHA')} labels={brokerLabel} />
          </Field>
          <Field label="Execution status">
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
              <TableHead>Master</TableHead>
              <TableHead>Broker</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Order ID</TableHead>
              <TableHead>Execution</TableHead>
              <TableHead className="text-right">Copies</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableLoading cols={COLS} />
            ) : q.error ? (
              <TableError cols={COLS} error={q.error} />
            ) : !q.data?.items.length ? (
              <TableEmpty cols={COLS} message="No master trades yet. They appear here as soon as a connected master executes an order." />
            ) : (
              q.data.items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/admin/users/${t.masterUserId}`} className="font-medium hover:underline">
                      {t.masterName}
                    </Link>
                  </TableCell>
                  <TableCell>{brokerLabel(t.broker)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{t.symbol}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{t.exchange}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={t.side} />
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatNumber(t.filledQuantity)}
                    {t.filledQuantity !== t.quantity ? <span className="text-muted-foreground"> / {formatNumber(t.quantity)}</span> : null}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatINR(t.averagePrice ?? t.price)}</TableCell>
                  <TableCell className="font-mono text-xs">{t.brokerOrderId}</TableCell>
                  <TableCell>
                    <StatusBadge value={t.status} />
                  </TableCell>
                  <TableCell className="tabular text-right">
                    <Link href={`/admin/copy-orders?masterTradeId=${t.id}`} className="text-primary hover:underline">
                      {t.copyOrderCount ?? 0}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(t.eventTimestamp)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {q.data ? <Pagination page={list.page} pageSize={list.pageSize} total={q.data.total} onPage={list.setPage} /> : null}
      </Card>
    </>
  );
}
