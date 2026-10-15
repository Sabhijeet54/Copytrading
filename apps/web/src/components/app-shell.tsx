'use client';

import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  Building2,
  CandlestickChart,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Copy,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  PlusCircle,
  Radio,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { AuthUser, Role } from '@ctp/types';
import { useRealtime } from '@/components/realtime';
import { Button } from '@/components/ui/button';
import { humanize } from '@/lib/format';
import { useLogout, useMyBrokerAccounts } from '@/lib/queries';
import { useFeedStatus } from '@/lib/trading';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Active only on exactly this path (not on sub-pages). */
  exact?: boolean;
  /** Other paths that highlight this item (e.g. a detail page). */
  also?: string[];
}
interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Role-based menus. Every item opens its OWN page (no in-page scrolling to #anchors), so each screen shows
 * one thing clearly.
 */
const MENUS: Record<Role, NavSection[]> = {
  MASTER: [
    {
      title: 'Workspace',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/master', label: 'Strategies', icon: Layers, exact: true },
        { href: '/master/place-trade', label: 'Place trade', icon: PlusCircle },
        { href: '/master/trades', label: 'Live trades', icon: CandlestickChart },
        { href: '/master/positions', label: 'Open positions', icon: Briefcase },
        { href: '/master/clients', label: 'Clients', icon: Users, also: ['/master/client'] },
      ],
    },
    {
      title: 'Configuration',
      items: [
        { href: '/broker', label: 'Broker accounts', icon: Wallet },
        { href: '/settings', label: 'Profile & settings', icon: Settings },
      ],
    },
  ],
  FOLLOWER: [
    {
      title: 'Workspace',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/portfolio', label: 'My strategies', icon: Copy, exact: true },
        { href: '/portfolio/positions', label: 'Positions', icon: Briefcase },
        { href: '/portfolio/holdings', label: 'Holdings', icon: Wallet },
        { href: '/portfolio/orders', label: "Today's orders", icon: ListOrdered },
      ],
    },
    {
      title: 'Configuration',
      items: [
        { href: '/broker-api', label: 'Broker API', icon: KeyRound },
        { href: '/broker', label: 'Broker connection', icon: Building2 },
        { href: '/settings', label: 'Account settings', icon: Settings },
      ],
    },
  ],
  ADMIN: [
    {
      title: 'Workspace',
      items: [
        { href: '/admin', label: 'Overview', icon: ShieldCheck, exact: true },
        { href: '/admin/users', label: 'Users & licences', icon: Users },
        { href: '/admin/strategies', label: 'Strategies', icon: Layers },
        { href: '/admin/signals', label: 'Trade history', icon: Radio },
        { href: '/admin/master-trades', label: 'Master orders', icon: BarChart3 },
        { href: '/admin/copy-orders', label: 'Client copied orders', icon: ArrowLeftRight },
        { href: '/admin/positions', label: 'Positions', icon: Briefcase },
      ],
    },
    {
      title: 'Operations',
      items: [
        { href: '/admin/brokers', label: 'Broker connections', icon: Wallet },
        { href: '/admin/logs', label: 'Audit logs', icon: ScrollText },
        { href: '/admin/system-health', label: 'System health', icon: Activity },
        { href: '/settings', label: 'Settings', icon: Settings },
      ],
    },
  ],
};

const COLLAPSE_KEY = 'ctp.sidebar.collapsed';

/** NSE cash/F&O regular session in IST, Mon–Fri 09:15–15:30 (exchange holidays not included). */
function marketOpenNow(now = new Date()): boolean {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60_000);
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const m = ist.getHours() * 60 + ist.getMinutes();
  return m >= 9 * 60 + 15 && m < 15 * 60 + 30;
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.also?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        tone === 'ok' && 'bg-emerald-500',
        tone === 'warn' && 'bg-amber-400',
        tone === 'bad' && 'bg-red-500',
        tone === 'idle' && 'bg-zinc-500',
      )}
    />
  );
}

/** Live status shown in the sidebar and the top header. */
function useStatus(user: AuthUser) {
  const { connected } = useRealtime();
  const brokers = useMyBrokerAccounts();
  const feedEnabled = user.role === 'MASTER' || user.role === 'ADMIN';
  const feed = useFeedStatus(feedEnabled);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(marketOpenNow());
    const t = setInterval(() => setOpen(marketOpenNow()), 30_000);
    return () => clearInterval(t);
  }, []);
  const accounts = brokers.data ?? [];
  const brokerConnected = accounts.some((a) => a.status === 'CONNECTED');
  const brokerExpired = !brokerConnected && accounts.some((a) => a.status === 'EXPIRED');
  return {
    socket: connected,
    marketOpen: open,
    broker: user.role === 'ADMIN' ? null : brokerConnected ? 'connected' : brokerExpired ? 'expired' : 'disconnected',
    feed: feedEnabled ? (feed.data?.state ?? null) : null,
  } as const;
}

export function AppShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const status = useStatus(user);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const today = useMemo(() => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()), []);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const sections = MENUS[user.role] ?? [];
  const workspaceLabel = user.role === 'ADMIN' ? 'Admin workspace' : user.role === 'MASTER' ? 'Master workspace' : 'Client workspace';

  const sidebar = (mini: boolean) => (
    <nav className="flex h-full flex-col gap-5 px-3 py-5">
      <Link href={user.role === 'ADMIN' ? '/admin' : '/dashboard'} className={cn('flex items-center gap-2 px-2', mini && 'justify-center px-0')}>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ClipboardList className="size-4" />
        </span>
        {!mini ? (
          <span className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight text-foreground">CopyTrade</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-sidebar-muted">{workspaceLabel}</span>
          </span>
        ) : null}
      </Link>

      {/* Live status */}
      {status.broker || status.feed ? (
        <div className={cn('flex flex-col gap-1.5 rounded-xl bg-muted p-2.5 text-xs text-sidebar-foreground', mini && 'items-center p-2')}>
          {status.broker ? (
            <span className="flex items-center gap-2" title={`Broker ${status.broker}`}>
              <Dot tone={status.broker === 'connected' ? 'ok' : status.broker === 'expired' ? 'warn' : 'bad'} />
              {!mini ? `Broker ${status.broker}` : null}
            </span>
          ) : null}
          {status.feed ? (
            <span className="flex items-center gap-2" title={`Market feed ${status.feed}`}>
              <Dot tone={status.feed === 'LIVE' ? 'ok' : status.feed === 'CONNECTING' ? 'warn' : status.feed === 'DOWN' ? 'bad' : 'idle'} />
              {!mini ? <span className="font-semibold tracking-wide">{status.feed}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            {!mini ? <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">{section.title}</p> : <div className="mx-2 mb-1 border-t border-sidebar-accent" />}
            {section.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={mini ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-active focus-visible:outline-2 focus-visible:outline-primary',
                    active && 'bg-sidebar-accent font-bold text-foreground',
                    mini && 'justify-center px-0',
                  )}
                >
                  <Icon className="size-4 shrink-0 opacity-80" />
                  {!mini ? item.label : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className={cn('rounded-2xl bg-accent p-3', mini && 'p-2')}>
        {!mini ? (
          <>
            <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
            <p className="truncate text-xs text-sidebar-muted">{user.email}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-sidebar-muted">{humanize(user.role)}</p>
          </>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          title="Sign out"
          className={cn('mt-2 h-7 w-full justify-start px-2 text-sidebar-foreground hover:bg-white hover:text-sidebar-active', mini && 'mt-0 justify-center px-0')}
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
        >
          <LogOut /> {!mini ? 'Sign out' : null}
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-frame lg:p-4">
    <div
      className={cn(
        'min-h-dvh bg-background lg:grid lg:min-h-[calc(100dvh-2rem)] lg:rounded-[1.75rem] lg:shadow-[0_20px_60px_-30px_rgba(100,37,254,0.35)]',
        collapsed ? 'lg:grid-cols-[4.5rem_1fr]' : 'lg:grid-cols-[15.5rem_1fr]',
      )}
    >
      <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] rounded-l-[1.75rem] border-r bg-sidebar lg:block">{sidebar(collapsed)}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar">
            <button className="absolute right-3 top-5 text-sidebar-foreground" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar(false)}
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6 lg:rounded-tr-[1.75rem]">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </Button>
          <span className="text-sm font-medium text-muted-foreground max-sm:hidden">{today}</span>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5" title="Market hours (NSE, Mon–Fri 09:15–15:30 IST)">
              <Dot tone={status.marketOpen ? 'ok' : 'idle'} />
              <span className="max-sm:hidden">{status.marketOpen ? 'Market open' : 'Market closed'}</span>
            </span>
            <span className="flex items-center gap-1.5" title={status.socket ? 'Live updates connected' : 'Live updates reconnecting…'}>
              <Dot tone={status.socket ? 'ok' : 'warn'} />
              <span className="font-semibold tracking-wide">{status.socket ? 'LIVE' : 'OFFLINE'}</span>
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
    </div>
  );
}
