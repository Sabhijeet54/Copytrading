'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { BrokerCallbackNotice } from '@/components/broker-connect';
import { ClientDashboard } from '@/components/client-dashboard';
import { MasterDashboard } from '@/components/master-dashboard';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/queries';

export default function DashboardPage() {
  const { data: user } = useMe();
  if (!user) return null;

  return (
    <>
      <Suspense fallback={null}>
        <BrokerCallbackNotice />
      </Suspense>
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0]}`}
        description={user.role === 'MASTER' ? 'Master trader account' : user.role === 'FOLLOWER' ? 'Client account' : 'Administrator account'}
        actions={
          user.role === 'ADMIN' || user.role === 'SUB_ADMIN' ? (
            <Button asChild>
              <Link href="/admin">
                Open admin console <ArrowRight />
              </Link>
            </Button>
          ) : null
        }
      />

      {user.role === 'FOLLOWER' ? <ClientDashboard /> : null}
      {user.role === 'MASTER' ? <MasterDashboard /> : null}

    </>
  );
}
