'use client';

import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  ClipboardList,
  CandlestickChart,
  LayoutDashboard,
  PieChart,
  Layers,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthUser, Role } from '@ctp/types';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/lib/queries';
import { humanize } from '@/lib/format';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}
interface NavSection {
  title?: string;
  roles?: Role[];
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    title: 'Trading',
    roles: ['MASTER'],
    items: [{ href: '/master', label: 'Master desk', icon: CandlestickChart }],
  },
  {
    title: 'Trading',
    roles: ['FOLLOWER'],
    items: [{ href: '/portfolio', label: 'My portfolio', icon: PieChart }],
  },
  {
    title: 'Administration',
    roles: ['ADMIN'],
    items: [
      { href: '/admin', label: 'Overview', icon: ShieldCheck, exact: true },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/brokers', label: 'Broker accounts', icon: Wallet },
      { href: '/admin/strategies', label: 'Strategies', icon: Layers },
      { href: '/admin/master-trades', label: 'Master trades', icon: BarChart3 },
      { href: '/admin/copy-orders', label: 'Copy orders', icon: ArrowLeftRight },
      { href: '/admin/positions', label: 'Positions', icon: Briefcase },
      { href: '/admin/logs', label: 'Audit logs', icon: ScrollText },
      { href: '/admin/system-health', label: 'System health', icon: Activity },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  const sections = NAV.filter((s) => !s.roles || s.roles.includes(user.role));

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 px-3 py-5">
      <Link href={user.role === 'ADMIN' ? '/admin' : '/dashboard'} className="flex items-center gap-2 px-2">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <ClipboardList className="size-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight text-white">CopyTrade</span>
      </Link>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {sections.map((section, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {section.title ? (
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{section.title}</p>
            ) : null}
            {section.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-white',
                    active && 'bg-sidebar-accent font-medium text-white',
                  )}
                >
                  <Icon className="size-4 opacity-80" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-sidebar-accent/60 p-3">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-sidebar-muted">{user.email}</p>
        <p className="mt-1 text-[11px] uppercase tracking-wider text-sidebar-muted">{humanize(user.role)}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full justify-start px-2 text-sidebar-foreground hover:bg-sidebar hover:text-white"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
        >
          <LogOut /> Sign out
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh bg-sidebar lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar">
            <button className="absolute right-3 top-5 text-sidebar-foreground" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <span className="text-sm font-semibold">CopyTrade</span>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
