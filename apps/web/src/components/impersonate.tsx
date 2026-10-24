'use client';

import { ExternalLink, LogIn } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/** Master: open the client's own panel with full access (broker connect, strategies, settings…). */
export function OpenClientPanelButton({ userId, name }: { userId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/auth/impersonate/${userId}`, { method: 'POST' });
          window.location.assign('/dashboard');
        } catch (e) {
          toast.error((e as Error).message);
          setBusy(false);
        }
      }}
      title={`Open ${name}'s panel with full access`}
    >
      <LogIn /> {busy ? 'Opening…' : 'Open client panel'}
    </Button>
  );
}

/** Banner shown while a master is inside a client's panel. */
export function ImpersonationBanner({ clientName, by }: { clientName: string; by: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:px-6">
      <span>
        You ({by}) are inside <strong>{clientName}</strong>&apos;s panel — every change here is made on the client&apos;s account.
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api('/auth/impersonate-exit', { method: 'POST' });
            window.location.assign('/master/clients');
          } catch (e) {
            toast.error((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <ExternalLink /> Back to master
      </Button>
    </div>
  );
}
