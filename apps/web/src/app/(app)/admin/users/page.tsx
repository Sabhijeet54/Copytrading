'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { EnumSelect } from '@/components/enum-select';
import { Field, FilterBar } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { TableEmpty, TableError, TableLoading } from '@/components/table-states';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BrokerName, Role, UserStatus } from '@ctp/types';
import { brokerLabel, formatDateTime } from '@/lib/format';
import { useAdminUsers } from '@/lib/queries';
import { useListState } from '@/lib/use-list-state';

const COLS = 7;

export default function AdminUsersPage() {
  const list = useListState({ search: '', role: '', status: '', broker: '' });
  const q = useAdminUsers(list.params);

  return (
    <>
      <PageHeader title="Users" description="Every account on the platform. Credentials and broker tokens are never shown." />
      <Card className="overflow-hidden">
        <FilterBar onReset={list.reset} active={list.active}>
          <Field label="Search" className="grid w-64 gap-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Name, email or mobile"
                value={list.filters.search}
                onChange={(e) => list.setFilter('search', e.target.value)}
              />
            </div>
          </Field>
          <Field label="Role">
            <EnumSelect value={list.filters.role} onChange={(v) => list.setFilter('role', v)} options={Object.values(Role)} />
          </Field>
          <Field label="Status">
            <EnumSelect value={list.filters.status} onChange={(v) => list.setFilter('status', v)} options={Object.values(UserStatus)} />
          </Field>
          <Field label="Broker">
            <EnumSelect
              value={list.filters.broker}
              onChange={(v) => list.setFilter('broker', v)}
              options={Object.values(BrokerName)}
              labels={brokerLabel}
            />
          </Field>
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Broker accounts</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableLoading cols={COLS} />
            ) : q.error ? (
              <TableError cols={COLS} error={q.error} />
            ) : !q.data?.items.length ? (
              <TableEmpty cols={COLS} message="No users match these filters." />
            ) : (
              q.data.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                      {u.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={u.role} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={u.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.brokerAccounts.length === 0 ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        u.brokerAccounts.map((b) => <StatusBadge key={b.id} value={b.status} label={brokerLabel(b.broker)} />)
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{u.emailVerified ? 'Verified' : <span className="text-muted-foreground">Unverified</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(u.lastLoginAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(u.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {q.data ? <Pagination page={list.page} pageSize={list.pageSize} total={q.data.total} onPage={list.setPage} /> : null}
      </Card>
    </>
  );
}
