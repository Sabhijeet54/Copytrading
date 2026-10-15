'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AdminUserDetail, AdminUserListItem } from '@ctp/types';
import { AllocationFields, type AllocState, allocFromSub, allocToInput } from '@/components/allocation-fields';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/format';
import { useAdminUserMutations } from '@/lib/queries';
import { type UserStrategyRow, useAdminUserStrategies, useAdminUserStrategyMutations } from '@/lib/trading';
import { cn } from '@/lib/utils';

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

/** Licence plans offered everywhere (Add user + Assign licence). */
export const LICENCE_PLANS = [
  { value: '2', label: '2 Days (trial)' },
  { value: '30', label: '30 Days' },
  { value: '365', label: 'Admin key (365 days)' },
] as const;

function LicencePicker({ id, plan, custom, onPlan, onCustom, allowNone }: { id: string; plan: string; custom: string; onPlan: (v: string) => void; onCustom: (v: string) => void; allowNone?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
      <Select id={id} value={plan} onChange={(e) => onPlan(e.target.value)}>
        {LICENCE_PLANS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom days…</option>
        {allowNone ? <option value="none">No licence</option> : null}
      </Select>
      {plan === 'custom' ? (
        <Input aria-label="Days" className="w-24" type="number" min={1} max={3650} inputMode="numeric" placeholder="Days" value={custom} onChange={(e) => onCustom(e.target.value)} />
      ) : (
        <span />
      )}
    </div>
  );
}

const planDays = (plan: string, custom: string) => (plan === 'none' ? undefined : plan === 'custom' ? Number(custom) || undefined : Number(plan));

export function AddUserDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (u: AdminUserDetail) => void }) {
  const { create } = useAdminUserMutations();
  const empty = { name: '', email: '', mobile: '', password: '', role: 'FOLLOWER' as RoleValue, plan: '2', custom: '' };
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
        licenceDays: f.role === 'FOLLOWER' ? planDays(f.plan, f.custom) : undefined,
      },
      {
        onSuccess: (u) => {
          toast.success(`User ${f.email} created`);
          onOpenChange(false);
          onCreated?.(u as AdminUserDetail);
        },
        onError: (err) => toast.error(err.message),
      },
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
          {f.role === 'FOLLOWER' ? (
            <F id="au-lic" label="Licence" hint="Copy trading stops automatically when the licence expires">
              <LicencePicker id="au-lic" plan={f.plan} custom={f.custom} onPlan={(v) => setF({ ...f, plan: v })} onCustom={(v) => setF({ ...f, custom: v })} allowNone />
            </F>
          ) : null}
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
  const [plan, setPlan] = useState('30');
  const [custom, setCustom] = useState('');
  const [extend, setExtend] = useState(true);
  useEffect(() => {
    if (user) {
      setPlan(user.licenceDays === 2 ? '2' : user.licenceDays === 365 ? '365' : '30');
      setCustom('');
      setExtend(true);
    }
  }, [user]);
  const days = planDays(plan, custom) ?? 0;
  const running = user?.licenceExpiresAt && new Date(user.licenceExpiresAt).getTime() > Date.now();
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign licence</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{user?.name}</span> {user?.mobile ? `· ${user.mobile}` : ''}
            <br />
            {user?.licenceExpiresAt ? `${running ? 'Valid till' : 'Expired on'} ${formatDateTime(user.licenceExpiresAt)}` : 'No licence assigned yet.'}
          </DialogDescription>
        </DialogHeader>
        <F id="lic-plan" label="Select licence">
          <LicencePicker id="lic-plan" plan={plan} custom={custom} onPlan={setPlan} onCustom={setCustom} />
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
            disabled={licence.isPending || !(days > 0)}
            onClick={() =>
              user &&
              licence.mutate(
                { id: user.id, days, extend },
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

/** Which strategies this client gets, and with which lot multiplier / allocation. */
export function UserStrategiesDialog({ user, onClose }: { user: Pick<AdminUserListItem, 'id' | 'name' | 'email'> | null; onClose: () => void }) {
  const q = useAdminUserStrategies(user?.id ?? null);
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Strategies · {user?.name}</DialogTitle>
          <DialogDescription>Give each client only the strategies you want, each with its own lot multiplier. The client sees only these.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {q.error ? <p className="text-sm text-destructive">{q.error.message}</p> : null}
        {q.data && q.data.length === 0 ? <p className="text-sm text-muted-foreground">No strategies exist yet — a master must create one first.</p> : null}
        <div className="grid gap-3">{user ? q.data?.map((row) => <StrategyAccessRow key={row.strategyId} userId={user.id} row={row} />) : null}</div>
      </DialogContent>
    </Dialog>
  );
}

function StrategyAccessRow({ userId, row }: { userId: string; row: UserStrategyRow }) {
  const { assign, remove } = useAdminUserStrategyMutations(userId);
  const [open, setOpen] = useState(false);
  const [alloc, setAlloc] = useState<AllocState>(allocFromSub(row.subscription));
  const [startCopy, setStartCopy] = useState(false);
  useEffect(() => setAlloc(allocFromSub(row.subscription)), [row.subscription]);
  const save = () => {
    const body = allocToInput(alloc);
    if (typeof body === 'string') return void toast.error(body);
    assign.mutate(
      { strategyId: row.strategyId, body: { ...body, startCopy: startCopy || row.subscription?.copyStatus === 'ON' } },
      {
        onSuccess: (r) => {
          if (r.warning) toast.warning(r.warning);
          else toast.success(`${row.name} ${row.assigned ? 'updated' : 'assigned'}`);
          setOpen(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };
  return (
    <div className={cn('rounded-lg border p-3', row.assigned && 'border-primary/40 bg-primary/5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {row.name} <span className="text-xs font-normal text-muted-foreground">by {row.masterName}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {row.assigned && row.subscription ? (
              <>
                Assigned · {row.subscription.allocation} · copy {row.subscription.copyStatus}
              </>
            ) : (
              'Not assigned'
            )}
            {row.status !== 'ACTIVE' ? ` · strategy ${row.status.toLowerCase()}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {row.assigned ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate(row.strategyId, { onSuccess: () => toast.success(`${row.name} removed`), onError: (e) => toast.error(e.message) })}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setOpen((o) => !o)}>
              Assign
            </Button>
          )}
        </div>
      </div>
      {open ? (
        <div className="mt-3 grid gap-3 border-t pt-3">
          <AllocationFields id={`as-${row.strategyId}`} value={alloc} onChange={setAlloc} compact />
          {row.subscription?.copyStatus !== 'ON' ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={startCopy} onChange={(e) => setStartCopy(e.target.checked)} />
              Start copying now (only if the client&apos;s broker is connected)
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={assign.isPending} onClick={save}>
              {assign.isPending ? 'Saving…' : row.assigned ? 'Save' : 'Assign strategy'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
