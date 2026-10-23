'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Card } from '@/components/ui/card';
import { formatDateTime, humanize } from '@/lib/format';
import { type ActivityRow, useActivity } from '@/lib/trading';
import { cn } from '@/lib/utils';

const SIDE_STYLE: Record<ActivityRow['side'], string> = {
  YOU: 'bg-sky-100 text-sky-800',
  ADMIN: 'bg-violet-100 text-violet-800',
  MASTER: 'bg-amber-100 text-amber-800',
  CLIENT: 'bg-muted text-foreground',
  SYSTEM: 'bg-muted text-muted-foreground',
};

/** Plain-language description of one audit entry. */
function describe(r: ActivityRow): string {
  const m = r.metadata ?? {};
  const on = r.on ? ` — ${r.on}` : '';
  switch (r.action) {
    case 'USER_LOGIN':
      return 'Logged in';
    case 'USER_LOGIN_FAILED':
      return 'Login failed (wrong password)';
    case 'USER_LOGOUT':
      return 'Logged out';
    case 'USER_REGISTERED':
      return 'Account created';
    case 'PASSWORD_CHANGED':
      return 'Password changed';
    case 'EMAIL_VERIFIED':
      return 'Email verified';
    case 'BROKER_CONNECTED':
      return `Broker connected${on}`;
    case 'BROKER_DISCONNECTED':
    case 'ADMIN_DISCONNECTED_BROKER':
      return `Broker disconnected${on}`;
    case 'BROKER_TOKEN_EXPIRED':
      return `Broker session expired${on}`;
    case 'COPY_STARTED':
      return `Auto trading started${on}`;
    case 'COPY_STOPPED':
      if (m.disconnected) return `Strategy disconnected${on}`;
      if (m.manualExit) return `Trade exited manually${on}`;
      return `Auto trading stopped${on}`;
    case 'ADMIN_STOPPED_COPY':
      return `Auto trading stopped by admin${on}${m.reason ? ` (${String(m.reason)})` : ''}`;
    case 'ADMIN_RESUMED_COPY':
      return `Auto trading resumed by admin${on}`;
    case 'ADMIN_DISABLED_USER':
      return 'Account disabled';
    case 'ADMIN_ENABLED_USER':
      return 'Account enabled';
    case 'COPY_ORDER_FAILED':
      return `Trade failed at broker${on}`;
    case 'AUTO_SQUARE_OFF':
      return `Auto square-off${on}`;
    case 'RISK_LIMIT_HIT':
      return `Risk limit hit${on}`;
    case 'KILL_SWITCH_ACTIVATED':
      return 'Emergency stop by admin';
    case 'PROFILE_UPDATED': {
      if (m.tradingMode) return `Trading mode set to ${String(m.tradingMode)}${m.paperClosed ? ` (${String(m.paperClosed)} paper trades closed)` : ''}`;
      if (m.brokerApi) return `Broker API details updated — ${String(m.brokerApi)}${Array.isArray(m.changed) && m.changed.length ? ` (${(m.changed as string[]).join(', ')})` : ''}`;
      if (m.licenceDays) return `Licence assigned — ${String(m.licenceDays)} days`;
      if (m.createdByAdmin) return 'Account created by admin';
      if (r.on) return `Strategy settings changed${on}`;
      return 'Profile updated';
    }
    default:
      return `${humanize(r.action)}${on}`;
  }
}

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const q = useActivity(page);
  const rows = q.data?.items ?? [];
  return (
    <>
      <PageHeader title="Activity log" description="Every change on your account — who made it (you, admin, master or system) — and your logins." />
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 p-4 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{describe(r)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(r.at)}
                    {r.ip ? ` · IP ${r.ip}` : ''}
                  </p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', SIDE_STYLE[r.side])}>by {r.by}</span>
              </div>
            ))}
          </div>
        )}
        {q.data ? <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} /> : null}
      </Card>
    </>
  );
}
