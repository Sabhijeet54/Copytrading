'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChangePassword, useMe, useUpdateProfile } from '@/lib/queries';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;

function ProfileForm({ name: initialName, mobile: initialMobile, telegram: initialTelegram }: { name: string; mobile: string; telegram: string }) {
  const update = useUpdateProfile();
  const [name, setName] = useState(initialName);
  const [mobile, setMobile] = useState(initialMobile);
  const [telegramChatId, setTelegram] = useState(initialTelegram);
  const dirty = name !== initialName || mobile !== initialMobile || telegramChatId !== initialTelegram;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          { name, mobile, telegramChatId },
          { onSuccess: () => toast.success('Profile updated'), onError: (err) => toast.error(err.message) },
        );
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="mobile">Mobile</Label>
        <Input id="mobile" type="tel" placeholder="+91XXXXXXXXXX" value={mobile} onChange={(e) => setMobile(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="tg">Telegram chat ID (alerts)</Label>
        <Input id="tg" inputMode="numeric" placeholder="e.g. 123456789" value={telegramChatId} onChange={(e) => setTelegram(e.target.value)} />
        <p className="text-xs text-muted-foreground">Order fill/fail, disconnect and loss-limit alerts. Start a chat with the platform bot, then paste your chat id.</p>
      </div>
      <div>
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const change = useChangePassword();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const valid = PASSWORD_RULE.test(newPassword) && newPassword === confirm && currentPassword.length > 0;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate(
          { currentPassword, newPassword },
          {
            onSuccess: () => {
              toast.success('Password changed. Other devices have been signed out.');
              setCurrent('');
              setNew('');
              setConfirm('');
            },
            onError: (err) => toast.error(err.message),
          },
        );
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="current">Current password</Label>
        <Input id="current" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="new">New password</Label>
        <Input id="new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
        <p className="text-xs text-muted-foreground">At least 10 characters, including a letter and a number.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={confirm.length > 0 && confirm !== newPassword}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <div>
        <Button type="submit" disabled={!valid || change.isPending}>
          {change.isPending ? 'Updating…' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const { data: user } = useMe();
  if (!user) return null;
  return (
    <>
      <PageHeader title="Settings" description="Your profile and sign-in security." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm key={`${user.name}|${user.mobile}|${user.telegramChatId ?? ''}`} name={user.name} mobile={user.mobile ?? ''} telegram={user.telegramChatId ?? ''} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Changing your password signs out all other sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
