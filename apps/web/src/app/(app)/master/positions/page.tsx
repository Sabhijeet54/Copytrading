'use client';

import { MyAccountSection, PaperModeNotice } from '@/components/master-desk';
import { PageHeader } from '@/components/page-header';

export default function MasterPositionsPage() {
  return (
    <>
      <PageHeader title="Open positions" description="Your signal book and your broker account (positions, holdings, today's orders)." />
      <PaperModeNotice />
      <MyAccountSection />
    </>
  );
}
