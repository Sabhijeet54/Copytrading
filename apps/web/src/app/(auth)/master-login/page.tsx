'use client';

import { Suspense } from 'react';
import { LoginForm } from '../login-form';

/** Master / admin login — separate from the client login. Accounts are created by the admin only. */
export default function MasterLoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Master sign in</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">For strategy masters and admins only.</p>
      <Suspense>
        <LoginForm portal="staff" />
      </Suspense>
    </>
  );
}
