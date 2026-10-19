'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '../login-form';

/** Client login. Masters and admins sign in on /master-login. */
export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">Welcome back. Enter your account details.</p>
      <Suspense>
        <LoginForm portal="client" />
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
