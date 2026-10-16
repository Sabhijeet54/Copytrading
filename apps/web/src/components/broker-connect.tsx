'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { qk, useAngelOneLogin, useBrokerAvailability, useStartBrokerLogin } from '@/lib/queries';

/** Shows a toast for the ?broker=…&result=… redirect coming back from a broker callback, then cleans the URL. */
export function BrokerCallbackNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    const result = params.get('result');
    const broker = params.get('broker');
    if (!result || !broker) return;
    const name = broker === 'zerodha' ? 'Zerodha' : 'Angel One';
    if (result === 'connected') toast.success(`${name} connected`);
    else toast.error(`${name} login failed: ${params.get('message') ?? 'unknown error'}`);
    void qc.invalidateQueries({ queryKey: qk.myBrokerAccounts });
    router.replace('/dashboard');
  }, [params, router, qc]);
  return null;
}

export function AngelOneLoginDialog({ open, onOpenChange, defaultClientCode }: { open: boolean; onOpenChange: (o: boolean) => void; defaultClientCode?: string }) {
  const login = useAngelOneLogin();
  const [clientCode, setClientCode] = useState(defaultClientCode ?? '');
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');
  const valid = /^[A-Za-z0-9]{3,20}$/.test(clientCode) && /^\d{4,6}$/.test(pin) && /^\d{6}$/.test(totp);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log in to Angel One</DialogTitle>
          <DialogDescription>Your PIN and TOTP are sent to Angel One once and never stored.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate(
              { clientCode, pin, totp },
              {
                onSuccess: () => {
                  toast.success('Angel One connected');
                  setPin('');
                  setTotp('');
                  onOpenChange(false);
                },
                onError: (err) => {
                  setTotp('');
                  toast.error(err.message);
                },
              },
            );
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="ao-client">Client ID</Label>
            <Input id="ao-client" autoComplete="username" value={clientCode} onChange={(e) => setClientCode(e.target.value.toUpperCase())} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ao-pin">PIN</Label>
            <Input id="ao-pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ao-totp">TOTP</Label>
            <Input id="ao-totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code from your authenticator app" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!valid || login.isPending}>
              {login.isPending ? 'Logging in…' : 'Log in'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Connect / re-login buttons for each configured broker. */
export function BrokerConnectButtons({ angelClientCode, isMaster = false }: { angelClientCode?: string; isMaster?: boolean }) {
  const available = useBrokerAvailability();
  const start = useStartBrokerLogin();
  const [angelOpen, setAngelOpen] = useState(false);
  if (!available.data) return null;
  const { angelOne, angelOnePublisherLogin } = available.data;
  // Master uses Angel One only (Zerodha removed for the master).
  const zerodha = available.data.zerodha && !isMaster;
  if (!zerodha && !angelOne) {
    return <p className="text-sm text-muted-foreground">No broker is configured on the server yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {zerodha ? (
        <Button
          variant="outline"
          disabled={start.isPending}
          onClick={() => start.mutate('zerodha', { onError: (err) => toast.error(err.message) })}
        >
          Log in with Zerodha
        </Button>
      ) : null}
      {angelOne ? (
        <Button
          variant="outline"
          disabled={start.isPending}
          onClick={() =>
            angelOnePublisherLogin
              ? start.mutate('angel-one', { onError: (err) => toast.error(err.message) })
              : setAngelOpen(true)
          }
        >
          Log in with Angel One
        </Button>
      ) : null}
      {zerodha ? (
        <p className="w-full rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          {isMaster ? (
            <>
              <strong>Master: live market data needs a paid Kite Connect plan.</strong> With the free Kite Connect
              &quot;Personal&quot; plan, Zerodha will connect but live prices will NOT come. Use a paid Kite Connect app, or
              connect Angel One and choose &quot;Use Angel One&quot; for the live feed (free).
            </>
          ) : (
            <>
              <strong>Note:</strong> Zerodha connects through the platform&apos;s Kite Connect app. Orders work on every plan; live
              market data comes from the master feed, not from your account.
            </>
          )}
        </p>
      ) : null}
      <AngelOneLoginDialog key={angelClientCode} open={angelOpen} onOpenChange={setAngelOpen} defaultClientCode={angelClientCode} />
    </div>
  );
}
