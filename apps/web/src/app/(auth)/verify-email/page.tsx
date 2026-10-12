'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setState('error');
      setMessage('This verification link is incomplete.');
      return;
    }
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => setState('ok'))
      .catch((err: Error) => {
        setState('error');
        setMessage(err.message);
      });
  }, [token]);

  if (state === 'pending') return <p className="text-sm text-muted-foreground">Verifying your email…</p>;
  return (
    <div className="text-center">
      {state === 'ok' ? <CheckCircle2 className="mx-auto size-10 text-success" /> : <XCircle className="mx-auto size-10 text-destructive" />}
      <h1 className="mt-4 text-xl font-semibold">{state === 'ok' ? 'Email verified' : 'Verification failed'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{state === 'ok' ? 'You can now sign in.' : message}</p>
      <Button asChild className="mt-6">
        <Link href="/login">Go to sign in</Link>
      </Button>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
