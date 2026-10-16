'use client';

import { CheckCircle2, Layers, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FollowDialog } from '@/components/follow-dialog';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { humanize } from '@/lib/format';
import { type MarketplaceRow, useMarketplace } from '@/lib/trading';
import { cn } from '@/lib/utils';

const TILE = ['bg-[var(--tile-mint)]', 'bg-[var(--tile-violet)]', 'bg-[var(--tile-sand)]', 'bg-[var(--tile-lime)]', 'bg-[var(--tile-sky)]'];

/** Client marketplace: every strategy — connect with a lot multiplier, manage / disconnect in My strategies. */
export default function MarketplacePage() {
  const q = useMarketplace();
  const [pick, setPick] = useState<MarketplaceRow | null>(null);
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader title="Marketplace" description="All strategies. Connect one with your lot size — copying starts right away (broker must be connected)." />
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!q.isLoading && rows.length === 0 ? <p className="text-sm text-muted-foreground">No strategies available yet.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((s, i) => (
          <Card key={s.id} className="flex flex-col overflow-hidden">
            <div className={cn('flex items-start justify-between gap-3 p-5', TILE[i % TILE.length])}>
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-ink">{s.name}</p>
                <p className="text-xs text-ink/70">by {s.masterName ?? 'Master'}</p>
              </div>
              <Layers className="size-6 shrink-0 text-ink/70" />
            </div>
            <CardContent className="flex flex-1 flex-col gap-3 pt-4">
              {s.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{s.description}</p> : null}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-muted px-2 py-0.5">{humanize(s.riskLevel)} risk</span>
                <span className="rounded-full bg-muted px-2 py-0.5">{s.allowedExchanges.join(', ') || 'All exchanges'}</span>
                <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                  <Users className="size-3" /> {s.followerCount ?? 0}
                </span>
                {s.status !== 'ACTIVE' ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{humanize(s.status)}</span> : null}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                {s.connected ? (
                  <>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
                      <CheckCircle2 className="size-4" /> Connected · {s.allocationLabel}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/portfolio">Manage</Link>
                    </Button>
                  </>
                ) : (
                  <Button className="w-full" onClick={() => setPick(s)}>
                    Connect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <FollowDialog s={pick} onClose={() => setPick(null)} />
    </>
  );
}
