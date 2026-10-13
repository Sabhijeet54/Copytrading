'use client';

import { AppShell } from '@/components/app-shell';
import { RealtimeProvider } from '@/components/realtime';
import { RequireAuth } from '@/components/require-auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      {(user) => (
        <RealtimeProvider>
          <AppShell user={user}>{children}</AppShell>
        </RealtimeProvider>
      )}
    </RequireAuth>
  );
}
