'use client';

import { PauseCircle, StopCircle, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { StrategyStatus } from '@ctp/types';
import { EnumSelect } from '@/components/enum-select';
import { Field, FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { ReasonDialog } from '@/components/reason-dialog';
import { StatusBadge } from '@/components/status-badge';
import { TableEmpty, TableError, TableLoading } from '@/components/table-states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatINR, humanize } from '@/lib/format';
import { useAdminAction, useAdminStrategies, useAdminStrategyFollowers } from '@/lib/queries';
import { useListState } from '@/lib/use-list-state';

const COLS = 8;

function FollowersDialog({ strategy, onClose }: { strategy: { id: string; name: string } | null; onClose: () => void }) {
  const q = useAdminStrategyFollowers(strategy?.id ?? null);
  const stop = useAdminAction<{ reason: string }>('POST', (id) => `/admin/strategy-followers/${id}/stop`);
  const [stopId, setStopId] = useState<string | null>(null);
  return (
    <>
      <Dialog open={strategy !== null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{strategy?.name} — followers</DialogTitle>
            <DialogDescription>Subscriptions and their copy status.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {q.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !q.data?.length ? (
              <p className="text-sm text-muted-foreground">No followers yet.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {q.data.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div>
                      <Link href={`/admin/users/${f.followerUserId}`} className="font-medium hover:underline">
                        {f.followerName}
                      </Link>
                      <p className="text-muted-foreground">
                        {formatINR(f.allocationAmount)} · {humanize(f.allocationMode)}
                        {f.allocationPercent ? ` ${Number(f.allocationPercent)}%` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge value={f.copyStatus} label={`Copy ${f.copyStatus}`} />
                      {f.copyStatus !== 'OFF' ? (
                        <Button size="sm" variant="outline" onClick={() => setStopId(f.id)}>
                          <StopCircle /> Stop
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ReasonDialog
        open={stopId !== null}
        onOpenChange={(o) => !o && setStopId(null)}
        title="Stop copy trading for this follower?"
        description="No new copy orders will be created for this subscription."
        confirmLabel="Stop copy trading"
        pending={stop.isPending}
        onConfirm={(reason) =>
          stopId &&
          stop.mutate(
            { id: stopId, body: { reason } },
            { onSuccess: () => (toast.success('Copy trading stopped'), setStopId(null)), onError: (e) => toast.error(e.message) },
          )
        }
      />
    </>
  );
}

export default function AdminStrategiesPage() {
  const list = useListState({ status: '', search: '' });
  const q = useAdminStrategies(list.params);
  const pause = useAdminAction<{ reason: string }>('POST', (id) => `/admin/strategies/${id}/pause`);
  const [pauseTarget, setPauseTarget] = useState<{ id: string; name: string } | null>(null);
  const [followersOf, setFollowersOf] = useState<{ id: string; name: string } | null>(null);

  return (
    <>
      <PageHeader title="Strategies" description="Master strategies and their follower counts." />
      <Card className="overflow-hidden">
        <FilterBar onReset={list.reset} active={list.active}>
          <Field label="Search" className="grid w-56 gap-1.5">
            <Input placeholder="Strategy name" value={list.filters.search} onChange={(e) => list.setFilter('search', e.target.value)} />
          </Field>
          <Field label="Status">
            <EnumSelect value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={Object.values(StrategyStatus)} />
          </Field>
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Strategy</TableHead>
              <TableHead>Master</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Instruments</TableHead>
              <TableHead className="text-right">Followers</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableLoading cols={COLS} />
            ) : q.error ? (
              <TableError cols={COLS} error={q.error} />
            ) : !q.data?.items.length ? (
              <TableEmpty cols={COLS} message="No strategies match these filters." />
            ) : (
              q.data.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-medium">{s.name}</span>
                    {s.description ? <div className="max-w-72 truncate text-xs text-muted-foreground">{s.description}</div> : null}
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/users/${s.masterUserId}`} className="hover:underline">
                      {s.masterName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={s.status} />
                  </TableCell>
                  <TableCell>{humanize(s.riskLevel)}</TableCell>
                  <TableCell className="text-xs">
                    {s.allowedExchanges.join(', ') || 'Any'}
                    {s.allowedInstruments.length ? <span className="text-muted-foreground"> · {s.allowedInstruments.join(', ')}</span> : null}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {s.activeFollowerCount ?? 0} active / {s.followerCount ?? 0}
                    {s.maxFollowers ? <span className="text-muted-foreground"> (max {s.maxFollowers})</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(s.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setFollowersOf({ id: s.id, name: s.name })}>
                        <Users /> Followers
                      </Button>
                      {s.status === 'ACTIVE' ? (
                        <Button size="sm" variant="outline" onClick={() => setPauseTarget({ id: s.id, name: s.name })}>
                          <PauseCircle /> Pause
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {q.data ? <Pagination page={list.page} pageSize={list.pageSize} total={q.data.total} onPage={list.setPage} /> : null}
      </Card>
      <FollowersDialog strategy={followersOf} onClose={() => setFollowersOf(null)} />
      <ReasonDialog
        open={pauseTarget !== null}
        onOpenChange={(o) => !o && setPauseTarget(null)}
        title={`Pause ${pauseTarget?.name ?? ''}?`}
        description="Followers stop receiving copies of this master's trades until the master restarts the strategy."
        confirmLabel="Pause strategy"
        pending={pause.isPending}
        onConfirm={(reason) =>
          pauseTarget &&
          pause.mutate(
            { id: pauseTarget.id, body: { reason } },
            { onSuccess: () => (toast.success('Strategy paused'), setPauseTarget(null)), onError: (e) => toast.error(e.message) },
          )
        }
      />
    </>
  );
}
