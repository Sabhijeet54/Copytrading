'use client';

import { RequireRole } from '@/components/require-auth';
import { useMe } from '@/lib/queries';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: user } = useMe();
  if (!user) return null;
  return (
    <RequireRole user={user} roles={['ADMIN', 'SUB_ADMIN']}>
      {children}
    </RequireRole>
  );
}
