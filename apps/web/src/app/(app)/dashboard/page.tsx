'use client';

import { ArrowRight, CheckCircle2, MailWarning, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { toast } from 'sonner';
import { BrokerCallbackNotice, BrokerConnectButtons } from '@/components/broker-connect';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { brokerLabel, formatDateTime, humanize } from '@/lib/format';
import { useDisconnectBroker, useMe, useMyBrokerAccounts } from '@/lib/queries';

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
  const accounts = useMyBrokerAccounts();
  const disconnect = useDisconnectBroker();
  if (!user) return null;
  const angel = accounts.data?.find((a) => a.broker === 'ANGEL_ONE');

  return (
    <>
      <Suspense fallback={null}>
        <BrokerCallbackNotice />
      </Suspense>
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0]}`}
        description={user.role === 'MASTER' ? 'Master trader account' : user.role === 'FOLLOWER' ? 'Follower account' : 'Administrator account'}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trading account</CardTitle>
            <CardDescription>
              {user.role === 'MASTER'
                ? 'Your trades are detected from this broker account — you keep trading in the broker’s own app.'
                : 'Copied orders are placed in this broker account. Connecting a broker never starts copying by itself.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {accounts.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : accounts.data && accounts.data.length > 0 ? (
              <div className="divide-y rounded-lg border">
                {accounts.data.map((a) => (
                  <div key={a.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium">
                        <Wallet className="size-4 text-muted-foreground" />
                        {brokerLabel(a.broker)}
                      </span>
                      <StatusBadge value={a.status} />
                    </div>
                    <div className="mt-2 divide-y">
                      <Row label="Client ID">{a.brokerClientId ?? '—'}</Row>
                      <Row label="Token status">
                        <StatusBadge value={a.tokenStatus} />
                      </Row>
                      {a.tokenExpiresAt ? <Row label="Token expiry">{formatDateTime(a.tokenExpiresAt)}</Row> : null}
                      {a.lastError && a.tokenStatus !== 'ACTIVE' ? <Row label="Last error">{a.lastError}</Row> : null}
                    </div>
                    {a.status === 'CONNECTED' ? (
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disconnect.isPending}
                          onClick={() =>
                            disconnect.mutate(a.id, {
                              onSuccess: () => toast.success(`${brokerLabel(a.broker)} disconnected`),
                              onError: (err) => toast.error(err.message),
                            })
                          }
                        >
                          Disconnect
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">No broker connected</span>
                  <StatusBadge value="DISCONNECTED" label="Not connected" />
                </div>
                <p className="mt-2 text-muted-foreground">Log in with your broker below to connect it.</p>
              </div>
            )}
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">Broker sessions expire daily — log in again each trading day.</p>
              <BrokerConnectButtons angelClientCode={angel?.brokerClientId ?? undefined} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Manage your details and password in Settings.</CardDescription>
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
            <Row label="Role">{humanize(user.role)}</Row>
            <Row label="Mobile">{user.mobile ?? '—'}</Row>
            <Row label="Member since">{formatDateTime(user.createdAt)}</Row>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
