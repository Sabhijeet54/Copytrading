'use client';

import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{(user) => <AppShell user={user}>{children}</AppShell>}</RequireAuth>;
}
