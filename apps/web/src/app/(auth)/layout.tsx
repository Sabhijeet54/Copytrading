import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,32rem)]">
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(50rem_35rem_at_85%_90%,var(--tile-mint),transparent_60%),radial-gradient(40rem_30rem_at_0%_0%,#8a5bff,transparent_70%)] opacity-60" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <Link href="/" className="text-sm font-semibold text-white">
            AlgoMirror
          </Link>
          <div>
            <p className="max-w-md text-2xl font-semibold leading-snug text-white">
              The master trades in their own broker app. Your account follows — within the limits you set.
            </p>
            <p className="mt-4 max-w-md text-sm text-white/75">
              Broker sessions are authorised through the broker&apos;s own login. We never see or store your broker password.
            </p>
          </div>
          <p className="text-xs text-white/75">Trading involves risk. No investment advice is provided.</p>
        </div>
      </div>
      <div className="flex items-center justify-center bg-card px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
