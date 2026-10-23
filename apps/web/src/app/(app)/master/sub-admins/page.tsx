'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useSubAdminMutations, useSubAdmins } from '@/lib/trading';

const EMPTY = { name: '', email: '', mobile: '', password: '' };

/** Master's sub-admins: staff who log in on the master login page and work inside this master workspace. */
export default function SubAdminsPage() {
  const q = useSubAdmins();
  const { create, setStatus } = useSubAdminMutations();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name: f.name.trim(), email: f.email.trim(), mobile: f.mobile.trim() || undefined, password: f.password },
      { onSuccess: () => (toast.success('Sub-admin created'), setOpen(false), setF(EMPTY)), onError: (err) => toast.error(err.message) },
    );
  };
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader
        title="Sub-admins"
        description="Sub-admins sign in on the master login page and can manage your clients, licences, strategies and trades. They cannot change your broker account or create other sub-admins."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Add sub-admin
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {q.isLoading ? 'Loading…' : q.error ? q.error.message : 'No sub-admins yet.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>{r.mobile ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge value={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.lastLoginAt ? formatDateTime(r.lastLoginAt) : 'Never'}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate(
                          { id: r.id, status: r.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
                          { onSuccess: () => toast.success(r.status === 'ACTIVE' ? 'Sub-admin disabled' : 'Sub-admin enabled'), onError: (e) => toast.error(e.message) },
                        )
                      }
                    >
                      {r.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Add sub-admin</DialogTitle>
              <DialogDescription>They sign in on the master login page with this email and password.</DialogDescription>
            </DialogHeader>
            {(
              [
                ['name', 'Name', 'text'],
                ['email', 'Email', 'email'],
                ['mobile', 'Mobile', 'tel'],
                ['password', 'Password (10+ chars, letter + number)', 'password'],
              ] as const
            ).map(([k, label, type]) => (
              <div key={k} className="grid gap-1.5">
                <Label htmlFor={`sa-${k}`}>{label}</Label>
                <Input
                  id={`sa-${k}`}
                  type={type}
                  autoComplete={type === 'password' ? 'new-password' : 'off'}
                  required={k !== 'mobile'}
                  minLength={k === 'password' ? 10 : undefined}
                  value={f[k]}
                  onChange={(e) => setF({ ...f, [k]: e.target.value })}
                />
              </div>
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create sub-admin'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
