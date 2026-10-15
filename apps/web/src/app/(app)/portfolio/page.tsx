'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { FollowDialog } from '@/components/follow-dialog';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { humanize } from '@/lib/format';
import { type StrategyWithSub, useFollowStrategies, useToggleCopy } from '@/lib/trading';

/** Client: the strategies an admin / master assigned to me, my allocation and Start / Stop. */
export default function MyStrategiesPage() {
  const strategies = useFollowStrategies();
  const toggle = useToggleCopy();
  const [follow, setFollow] = useState<StrategyWithSub | null>(null);

  return (
    <>
      <PageHeader title="My strategies" description="Strategies assigned to you. Set your lot multiplier / limits, then press Start to copy their trades." />
      <Card>
        <CardHeader>
          <CardTitle>Assigned strategies</CardTitle>
          <CardDescription>Only strategies given to you by your admin or master trader are listed here.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead>Master</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Copying</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(strategies.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    {strategies.isLoading ? 'Loading…' : 'No strategy has been assigned to you yet — please contact your admin.'}
                  </TableCell>
                </TableRow>
              ) : (
                strategies.data!.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="max-w-72 truncate text-xs text-muted-foreground">{s.description}</div>
                    </TableCell>
                    <TableCell>{s.masterName}</TableCell>
                    <TableCell>{humanize(s.riskLevel)}</TableCell>
                    <TableCell>{s.allocationLabel ?? '—'}</TableCell>
                    <TableCell>
                      {s.subscription ? <StatusBadge value={s.subscription.copyStatus} /> : null}
                      {s.status !== 'ACTIVE' ? <div className="text-[11px] text-muted-foreground">Strategy {s.status.toLowerCase()}</div> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setFollow(s)}>
                          Settings
                        </Button>
                        {s.subscription ? (
                          s.subscription.copyStatus === 'ON' ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={toggle.isPending}
                              onClick={() => toggle.mutate({ id: s.subscription!.id, action: 'stop' }, { onSuccess: () => toast.success('Copying stopped'), onError: (e) => toast.error(e.message) })}
                            >
                              Stop
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={toggle.isPending || s.status !== 'ACTIVE'}
                              onClick={() => toggle.mutate({ id: s.subscription!.id, action: 'start' }, { onSuccess: () => toast.success('Copying started'), onError: (e) => toast.error(e.message) })}
                            >
                              Start
                            </Button>
                          )
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <FollowDialog s={follow} onClose={() => setFollow(null)} />
    </>
  );
}
