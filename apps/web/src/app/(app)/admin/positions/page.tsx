'use client';

import Link from 'next/link';
import { BrokerName } from '@ctp/types';
import { EnumSelect } from '@/components/enum-select';
import { Field, FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { TableEmpty, TableError, TableLoading } from '@/components/table-states';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { brokerLabel, formatDateTime, formatINR, formatNumber, humanize } from '@/lib/format';
import { useAdminPositions } from '@/lib/queries';
import { useListState } from '@/lib/use-list-state';
import { cn } from '@/lib/utils';

const COLS = 9;

function Pnl({ value }: { value: string }) {
  const n = Number(value);
  return <span className={cn('tabular', n > 0 && 'text-success', n < 0 && 'text-destructive')}>{formatINR(value)}</span>;
}

export default function AdminPositionsPage() {
  const list = useListState({ broker: '', scope: 'open' });
  const q = useAdminPositions(list.params);

  return (
    <>
      <PageHeader title="Positions" description="Net positions per broker account as last reconciled with the broker." />
      <Card className="overflow-hidden">
        <FilterBar>
          <Field label="Broker">
            <EnumSelect value={list.filters.broker} onChange={(v) => list.setFilter('broker', v)} options={Object.values(BrokerName)} labels={brokerLabel} />
          </Field>
          <Field label="Show">
            <Select value={list.filters.scope} onChange={(e) => list.setFilter('scope', e.target.value)}>
              <option value="open">Open positions</option>
              <option value="all">All (including closed)</option>
            </Select>
          </Field>
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Broker</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Net qty</TableHead>
              <TableHead className="text-right">Avg price</TableHead>
              <TableHead className="text-right">Unrealised</TableHead>
              <TableHead className="text-right">Realised</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableLoading cols={COLS} />
            ) : q.error ? (
              <TableError cols={COLS} error={q.error} />
            ) : !q.data?.items.length ? (
              <TableEmpty cols={COLS} message="No positions." />
            ) : (
              q.data.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/admin/users/${p.userId}`} className="font-medium hover:underline">
                      {p.userName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {p.broker ? brokerLabel(p.broker) : '—'} {p.isPaper ? <Badge variant="secondary">Paper</Badge> : null}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{p.symbol}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{p.exchange}</span>
                  </TableCell>
                  <TableCell>{humanize(p.productType)}</TableCell>
                  <TableCell className={cn('tabular text-right', p.quantity < 0 && 'text-destructive')}>{formatNumber(p.quantity)}</TableCell>
                  <TableCell className="tabular text-right">{formatINR(p.averagePrice)}</TableCell>
                  <TableCell className="text-right">
                    <Pnl value={p.unrealizedPnl} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Pnl value={p.realizedPnl} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(p.updatedAt)}</TableCell>
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
