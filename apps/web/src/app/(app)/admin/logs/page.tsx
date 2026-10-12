'use client';

import { AuditAction } from '@ctp/types';
import { EnumSelect } from '@/components/enum-select';
import { Field, FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { TableEmpty, TableError, TableLoading } from '@/components/table-states';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, humanize } from '@/lib/format';
import { useAdminAuditLogs } from '@/lib/queries';
import { istDayEndExclusive, istDayStart, useListState } from '@/lib/use-list-state';

const COLS = 5;

function tone(action: string) {
  if (/FAILED|DISABLED|REUSE/.test(action)) return 'destructive' as const;
  if (/STOPPED|DISCONNECTED|LOGOUT/.test(action)) return 'warning' as const;
  if (/FILLED|CONNECTED|VERIFIED|STARTED|RESUMED|ENABLED/.test(action)) return 'success' as const;
  return 'secondary' as const;
}

export default function AdminAuditLogsPage() {
  const list = useListState({ action: '', from: '', to: '' }, 50);
  const { from, to, ...rest } = list.params as Record<string, string | number>;
  const q = useAdminAuditLogs({ ...rest, from: istDayStart(String(from ?? '')), to: istDayEndExclusive(String(to ?? '')) });

  return (
    <>
      <PageHeader title="Audit logs" description="Append-only record of security and trading events. Secrets are redacted before storage." />
      <Card className="overflow-hidden">
        <FilterBar onReset={list.reset} active={list.active}>
          <Field label="Action" className="grid w-64 gap-1.5">
            <EnumSelect value={list.filters.action} onChange={(v) => list.setFilter('action', v)} options={Object.values(AuditAction)} />
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
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableLoading cols={COLS} />
            ) : q.error ? (
              <TableError cols={COLS} error={q.error} />
            ) : !q.data?.items.length ? (
              <TableEmpty cols={COLS} message="No audit events match these filters." />
            ) : (
              q.data.items.map((a) => (
                <TableRow key={a.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={tone(a.action)}>{humanize(a.action)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {a.actorEmail ?? <span className="text-muted-foreground">system / anonymous</span>}
                    {a.ip ? <div className="font-mono text-xs text-muted-foreground">{a.ip}</div> : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.targetType ? (
                      <>
                        {a.targetType}
                        {a.targetId ? <div className="font-mono text-muted-foreground">{a.targetId}</div> : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="max-w-md">
                    {a.metadata ? (
                      <code className="block whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
                        {JSON.stringify(a.metadata)}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
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
