'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLogin } from '@/lib/queries';
import { safeNext } from '../safe-next';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: (res) => {
          const fallback = res.user.role === 'ADMIN' ? '/admin' : '/dashboard';
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
        </p>
      ) : null}
      <Button type="submit" disabled={login.isPending || !email || !password}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">Welcome back. Enter your account details.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
