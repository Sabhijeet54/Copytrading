'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AdminUserListItem } from '@ctp/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/format';
import { useAdminUserMutations } from '@/lib/queries';

type RoleValue = 'ADMIN' | 'MASTER' | 'FOLLOWER';
const ROLE_LABEL: Record<RoleValue, string> = { FOLLOWER: 'Client (follower)', MASTER: 'Master trader', ADMIN: 'Admin' };

function F({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { create } = useAdminUserMutations();
  const empty = { name: '', email: '', mobile: '', password: '', role: 'FOLLOWER' as RoleValue, licenceDays: '' };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (open) setF(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        name: f.name.trim(),
        email: f.email.trim(),
        mobile: f.mobile.trim() || undefined,
        password: f.password,
        role: f.role,
        licenceDays: f.licenceDays ? Number(f.licenceDays) : undefined,
      },
      { onSuccess: () => (toast.success(`User ${f.email} created`), onOpenChange(false)), onError: (err) => toast.error(err.message) },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>The account is ready to log in immediately (email marked verified). Share the password securely.</DialogDescription>
          </DialogHeader>
          <F id="au-name" label="Name">
            <Input id="au-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />
          </F>
          <F id="au-email" label="Email">
            <Input id="au-email" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F id="au-mobile" label="Mobile">
              <Input id="au-mobile" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
            </F>
            <F id="au-role" label="User type">
              <Select id="au-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as RoleValue })}>
                {(Object.keys(ROLE_LABEL) as RoleValue[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </F>
          </div>
          <F id="au-pass" label="Password" hint="At least 10 characters with a letter and a number">
            <Input id="au-pass" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} />
          </F>
          <F id="au-lic" label="Licence (days, optional)" hint="Copy trading stops automatically when it expires">
            <Input id="au-lic" type="number" min={1} max={3650} inputMode="numeric" value={f.licenceDays} onChange={(e) => setF({ ...f, licenceDays: e.target.value })} />
          </F>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({ user, onClose }: { user: AdminUserListItem | null; onClose: () => void }) {
  const { update } = useAdminUserMutations();
  const [f, setF] = useState({ name: '', mobile: '', role: 'FOLLOWER' as RoleValue });
  useEffect(() => {
    if (user) setF({ name: user.name, mobile: user.mobile ?? '', role: user.role as RoleValue });
  }, [user]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    update.mutate(
      { id: user.id, name: f.name.trim(), mobile: f.mobile.trim() || undefined, role: f.role !== user.role ? f.role : undefined },
      { onSuccess: () => (toast.success('User updated'), onClose()), onError: (err) => toast.error(err.message) },
    );
  };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>{user?.email} — email cannot be changed here. Use the status menu to disable an account.</DialogDescription>
          </DialogHeader>
          <F id="eu-name" label="Name">
            <Input id="eu-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} />
          </F>
          <F id="eu-mobile" label="Mobile">
            <Input id="eu-mobile" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
          </F>
          <F id="eu-role" label="User type" hint="Role change is blocked while the user has active strategies / copy trading">
            <Select id="eu-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as RoleValue })}>
              {(Object.keys(ROLE_LABEL) as RoleValue[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </F>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LicenceDialog({ user, onClose }: { user: AdminUserListItem | null; onClose: () => void }) {
  const { licence, revoke } = useAdminUserMutations();
  const [days, setDays] = useState('30');
  const [extend, setExtend] = useState(true);
  useEffect(() => {
    if (user) {
      setDays('30');
      setExtend(true);
    }
  }, [user]);
  const running = user?.licenceExpiresAt && new Date(user.licenceExpiresAt).getTime() > Date.now();
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Licence · {user?.name}</DialogTitle>
          <DialogDescription>
            {user?.licenceExpiresAt ? `${running ? 'Valid till' : 'Expired on'} ${formatDateTime(user.licenceExpiresAt)}` : 'No licence assigned yet.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 7, 30, 90, 180, 365].map((d) => (
            <Button key={d} type="button" size="sm" variant={days === String(d) ? 'default' : 'outline'} onClick={() => setDays(String(d))}>
              {d}d
            </Button>
          ))}
        </div>
        <F id="lic-days" label="Days">
          <Input id="lic-days" type="number" min={1} max={3650} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </F>
        {running ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={extend} onChange={(e) => setExtend(e.target.checked)} />
            Add to the current licence (otherwise start fresh from today)
          </label>
        ) : null}
        <DialogFooter className="gap-2">
          {running ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={revoke.isPending}
              onClick={() =>
                user &&
                revoke.mutate(user.id, { onSuccess: () => (toast.success('Licence revoked — copy trading stopped'), onClose()), onError: (e) => toast.error(e.message) })
              }
            >
              Revoke
            </Button>
          ) : null}
          <Button
            disabled={licence.isPending || !(Number(days) > 0)}
            onClick={() =>
              user &&
              licence.mutate(
                { id: user.id, days: Number(days), extend },
                { onSuccess: () => (toast.success(`Licence of ${days} day(s) assigned`), onClose()), onError: (e) => toast.error(e.message) },
              )
            }
          >
            {licence.isPending ? 'Saving…' : 'Assign licence'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
