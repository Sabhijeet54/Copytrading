'use client';

import { ArrowRight, CheckCircle2, MailWarning } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { BrokerCallbackNotice } from '@/components/broker-connect';
import { ClientDashboard } from '@/components/client-dashboard';
import { MasterDashboard } from '@/components/master-dashboard';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, humanize } from '@/lib/format';
import { useMe } from '@/lib/queries';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

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
          user.role === 'ADMIN' ? (
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

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Manage your details and password in{' '}
            <Link href="/settings" className="font-medium text-primary hover:underline">
              Settings
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Email">{user.email}</Row>
          <Row label="Email verification">
            {user.emailVerified ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="size-4" /> Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-warning">
                <MailWarning className="size-4" /> Pending
              </span>
            )}
          </Row>
          <Row label="Role">{user.role === 'FOLLOWER' ? 'Client' : humanize(user.role)}</Row>
          <Row label="Mobile">{user.mobile ?? '—'}</Row>
          <Row label="Member since">{formatDateTime(user.createdAt)}</Row>
        </CardContent>
      </Card>
    </>
  );
}
