'use client';

import { Suspense } from 'react';
import { BrokerAccountsSection } from '@/components/broker-accounts-section';
import { BrokerCallbackNotice } from '@/components/broker-connect';
import { PageHeader } from '@/components/page-header';
import { useMe } from '@/lib/queries';

export default function BrokerPage() {
  const { data: user } = useMe();
  if (!user) return null;
  return (
    <>
      <Suspense fallback={null}>
        <BrokerCallbackNotice />
      </Suspense>
      <PageHeader title="Broker connection" description="Connect or re-connect your broker account. Sessions expire every day." />
      <div className="max-w-3xl">
        <BrokerAccountsSection user={user} />
      </div>
    </>
  );
}
