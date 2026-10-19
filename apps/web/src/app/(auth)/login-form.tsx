'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from '@/lib/queries';
import { safeNext } from './safe-next';

export function LoginForm({ portal = 'client' }: { portal?: 'client' | 'staff' }) {
  const router = useRouter();
  const params = useSearchParams();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { email, password, portal },
      {
        onSuccess: (res) => {
          const fallback = res.user.role === 'ADMIN' ? '/admin' : '/dashboard';
          // Staff portal ignores client deep links and vice versa (different areas).
          router.replace(safeNext(params.get('next'), fallback));
        },
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {login.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {login.error.message}
          {/master login/i.test(login.error.message) ? (
            <>
              {' '}
              <Link href="/master-login" className="font-medium underline">
                Open master login
              </Link>
            </>
          ) : /client login/i.test(login.error.message) ? (
            <>
              {' '}
              <Link href="/login" className="font-medium underline">
                Open client login
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <Button type="submit" disabled={login.isPending || !email || !password}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

