'use client';

import { CheckCircle2, Database, Server, Cpu, XCircle, Zap } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { TableEmpty } from '@/components/table-states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useAdminSystemHealth } from '@/lib/queries';

function Component({ name, icon: Icon, state, detail }: { name: string; icon: React.ComponentType<{ className?: string }>; state?: string; detail?: string }) {
  const ok = state === 'connected';
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" /> {name}
        </span>
        {state === undefined ? (
          <Skeleton className="h-5 w-20" />
        ) : ok ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <CheckCircle2 className="size-4" /> Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-destructive">
            <XCircle className="size-4" /> Down
          </span>
        )}
      </div>
      {detail ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}
    </Card>
  );
}

export default function SystemHealthPage() {
  const { data: h, error } = useAdminSystemHealth();

  return (
    <>
      <PageHeader
        title="System health"
        description="Live status of the API, database, Redis and the background worker. Refreshes every 10 seconds."
        actions={h ? <StatusBadge value={h.status === 'ok' ? 'ACTIVE' : 'WARNING'} label={h.status === 'ok' ? 'All systems OK' : 'Degraded'} /> : null}
      />
      {error ? <p className="mb-4 text-sm text-destructive">{error.message}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Component name="API" icon={Server} state={h ? 'connected' : undefined} detail={h ? `v${h.api.version} · ${h.api.environment} · up ${Math.floor(h.api.uptimeSeconds / 60)} min` : undefined} />
        <Component name="PostgreSQL" icon={Database} state={h?.database} />
        <Component name="Redis" icon={Zap} state={h?.redis} />
        <Component
          name="Worker"
          icon={Cpu}
          state={h?.worker}
          detail={h?.workerHeartbeat.lastSeenAt ? `Last heartbeat ${formatDateTime(h.workerHeartbeat.lastSeenAt)} · pid ${h.workerHeartbeat.pid}` : h ? 'No heartbeat — start it with `npm run worker`' : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trading safety</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paper mode</span>
              <StatusBadge value={h?.api.paperMode ? 'ACTIVE' : 'WARNING'} label={h ? (h.api.paperMode ? 'ON — no real orders' : 'OFF — live trading') : '…'} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Copy engine</span>
              {h?.copyHalt ? <StatusBadge value="CRITICAL" label="Halted" /> : <StatusBadge value="ACTIVE" label="Accepting" />}
            </div>
            {h?.copyHalt ? <p className="text-xs text-muted-foreground">Halted {formatDateTime(h.copyHalt.haltedAt)}: {h.copyHalt.reason}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Queues &amp; broker streams</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {h && h.queues.length === 0 && h.brokerStreams.length === 0
              ? 'No job queues or broker order streams are running yet. They are listed here once the copy engine and broker integrations are enabled.'
              : null}
            {h?.queues.map((q) => (
              <div key={q.name} className="flex justify-between py-1">
                <span>{q.name}</span>
                <span className="tabular">
                  {q.waiting} waiting · {q.active} active · {q.failed} failed
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Recent system events</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Event</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!h?.recentEvents.length ? (
              <TableEmpty cols={4} message="No system events recorded." />
            ) : (
              h.recentEvents.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.createdAt)}</TableCell>
                  <TableCell>
                    <StatusBadge value={e.severity} />
                  </TableCell>
                  <TableCell className="text-xs">{e.source}</TableCell>
                  <TableCell>
                    <span className="font-medium">{e.type}</span>
                    <div className="text-xs text-muted-foreground">{e.message}</div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
