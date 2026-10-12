import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,32rem)]">
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(60rem_40rem_at_10%_10%,color-mix(in_oklch,var(--primary)_35%,transparent),transparent)]" />
        <div className="relative flex h-full flex-col justify-between p-10 text-sidebar-foreground">
          <Link href="/" className="text-sm font-semibold text-white">
            CopyTrade
          </Link>
          <div>
            <p className="max-w-md text-2xl font-semibold leading-snug text-white">
              The master trades in their own broker app. Your account follows — within the limits you set.
            </p>
            <p className="mt-4 max-w-md text-sm text-sidebar-muted">
              Broker sessions are authorised through the broker&apos;s own login. We never see or store your broker password.
            </p>
          </div>
          <p className="text-xs text-sidebar-muted">Trading involves risk. No investment advice is provided.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
