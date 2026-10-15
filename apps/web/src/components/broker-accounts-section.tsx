'use client';

import Link from 'next/link';
import type { AuthUser } from '@ctp/types';
import { BrokerAccountCard } from '@/components/broker-account-card';
import { BrokerConnectButtons } from '@/components/broker-connect';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyBrokerAccounts } from '@/lib/queries';

/** The user's broker accounts with connect / reconnect buttons. */
export function BrokerAccountsSection({ user }: { user: AuthUser }) {
  const accounts = useMyBrokerAccounts();
  const angel = accounts.data?.find((a) => a.broker === 'ANGEL_ONE');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trading account</CardTitle>
        <CardDescription>
          {user.role === 'MASTER'
            ? 'Master account is used for LIVE MARKET DATA only (never places orders). Trades you take are mirrored to your clients.'
            : 'Copied orders are placed in this broker account. Connecting a broker never starts copying by itself.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : accounts.data && accounts.data.length > 0 ? (
          <div className="grid gap-3">
            {accounts.data.map((a) => (
              <BrokerAccountCard key={a.id} account={a} />
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
          <p className="mb-2 text-xs text-muted-foreground">
            Broker sessions expire daily — log in again each trading day.
            {user.role === 'FOLLOWER' ? (
              <>
                {' '}
                For live trading set up your own API app and static IP in{' '}
                <Link href="/broker-api" className="font-medium text-primary hover:underline">
                  Broker API
                </Link>
                .
              </>
            ) : null}
          </p>
          <BrokerConnectButtons angelClientCode={angel?.brokerClientId ?? undefined} isMaster={user.role === 'MASTER'} />
        </div>
      </CardContent>
    </Card>
  );
}
