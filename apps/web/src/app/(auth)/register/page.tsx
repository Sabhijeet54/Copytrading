'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRegister } from '@/lib/queries';
import { cn } from '@/lib/utils';


const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;

export default function RegisterPage() {
  const router = useRouter();
  const register = useRegister();
  const [form, setForm] = useState({ name: '', email: '', mobile: '', password: '', role: 'FOLLOWER' as const });
  const [verifyEmailSent, setVerifyEmailSent] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const passwordOk = PASSWORD_RULE.test(form.password);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    register.mutate(
      { name: form.name, email: form.email, password: form.password, role: form.role, mobile: form.mobile || undefined },
      {
        onSuccess: (res) => {
          if ('verificationRequired' in res) setVerifyEmailSent(true);
          else router.replace('/dashboard');
        },
      },
    );
  };

  if (verifyEmailSent) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h1 className="mt-4 text-xl font-semibold">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a verification link to <span className="font-medium text-foreground">{form.email}</span>. Verify your email,
          then sign in.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">Connecting a broker and starting auto trading come later — and only when you choose.</p>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" required value={form.name} onChange={set('name')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="mobile">
            Mobile <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="mobile" type="tel" autoComplete="tel" placeholder="+91XXXXXXXXXX" value={form.mobile} onChange={set('mobile')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={form.password.length > 0 && !passwordOk}
            value={form.password}
            onChange={set('password')}
          />
          <p className={cn('text-xs', form.password && !passwordOk ? 'text-destructive' : 'text-muted-foreground')}>
            At least 10 characters, including a letter and a number.
          </p>
        </div>
        {register.error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {register.error.message}
          </p>
        ) : null}
        <Button type="submit" disabled={register.isPending || !passwordOk || !form.name || !form.email}>
          {register.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
