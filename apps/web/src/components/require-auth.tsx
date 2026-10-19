'use client';

import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { AuthUser, Role } from '@ctp/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/queries';

/**
 * Client-side route protection (UX only). The API enforces authentication and RBAC on every
 * request, so hiding a page here is never the security boundary.
 */
export function RequireAuth({ children }: { children: (user: AuthUser) => React.ReactNode }) {
  const { data: user, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && user === null) {
      router.replace(`${/^\/(master|admin)(\/|$)/.test(pathname) ? '/master-login' : '/login'}?next=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, user, router, pathname]);

  if (isLoading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex w-64 flex-col gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }
  return <>{children(user)}</>;
}

export function RequireRole({ user, roles, children }: { user: AuthUser; roles: Role[]; children: React.ReactNode }) {
  if (roles.includes(user.role)) return <>{children}</>;
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <ShieldAlert className="mx-auto size-10 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-1 text-sm text-muted-foreground">This area requires the {roles.join(' or ').toLowerCase()} role.</p>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
