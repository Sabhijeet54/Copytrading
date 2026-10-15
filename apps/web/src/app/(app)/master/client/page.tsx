'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ClientDetail } from '@/components/master-client-detail';
import { Button } from '@/components/ui/button';

function Inner() {
  const id = useSearchParams().get('id');
  if (!id) return <p className="text-sm text-muted-foreground">No client selected.</p>;
  return <ClientDetail userId={id} />;
}

/** /master/client?id=… — everything about one client (a query param keeps the route shallow). */
export default function MasterClientPage() {
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/master/clients">
          <ArrowLeft /> All clients
        </Link>
      </Button>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <Inner />
      </Suspense>
    </>
  );
}
