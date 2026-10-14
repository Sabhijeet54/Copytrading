'use client';

import { Activity, CheckCircle2, Copy, Eye, EyeOff, Info, Link2, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type BrokerApiConfigView, type BrokerSlug, type SaveBrokerApiConfigInput, useBrokerApiConfig, useBrokerApiMutations } from '@/lib/broker-api';
import { formatDateTime } from '@/lib/format';
import { useMyBrokerAccounts } from '@/lib/queries';
import { cn } from '@/lib/utils';

const LABELS: Record<string, string> = {
  clientCode: 'Client Code',
  apiKey: 'API Key',
  apiSecret: 'API Secret',
  pin: 'PIN',
  totpSecret: 'TOTP secret',
  proxyHost: 'Static IP',
  proxyPort: 'Port',
};

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.error('Copy failed — select and copy manually'),
  );
}

/** Text/password field. For secrets, an empty value means "keep what is saved". */
function F({
  id,
  label,
  required,
  value,
  onChange,
  secret,
  saved,
  hint,
  type = 'text',
  inputMode,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
  saved?: boolean;
  hint?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label} {required ? <span className="text-destructive">*</span> : null}
        {secret && saved ? <span className="ml-2 text-xs font-normal text-success">● saved</span> : null}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={secret && !show ? 'password' : type}
          inputMode={inputMode}
          autoComplete={secret ? 'new-password' : 'off'}
          spellCheck={false}
          value={value}
          placeholder={secret && saved ? '•••••••• (leave blank to keep)' : ''}
          onChange={(e) => onChange(e.target.value)}
          className={secret ? 'pr-10' : undefined}
        />
        {secret ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? `Hide ${label}` : `Show ${label}`}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SetupSteps({ broker, cfg }: { broker: BrokerSlug; cfg?: BrokerApiConfigView }) {
  const angel = broker === 'angel-one';
  const ip = cfg?.lastTest?.ip ?? cfg?.proxyHost ?? 'your static IP';
  return (
    <details className="rounded-lg border bg-muted/30 p-4 text-sm" open={!cfg?.complete}>
      <summary className="cursor-pointer font-medium">
        <Info className="mr-1 inline size-4" /> Setup steps — {angel ? 'Angel One SmartAPI' : 'Zerodha Kite Connect'}
      </summary>
      <ol className="mt-3 grid list-decimal gap-2 pl-5 text-muted-foreground">
        <li>Buy a dedicated <strong>India static IP proxy</strong> (HTTP proxy, 24×7). Note its IP, port, username and password.</li>
        {angel ? (
          <>
            <li>
              Open <strong>smartapi.angelone.in</strong> → My Apps → <strong>Create / Add App</strong>. Set <strong>Primary static IP</strong> = <code>{ip}</code>.
            </li>
            <li>
              Redirect URL:{' '}
              <button type="button" className="inline-flex items-center gap-1 font-mono text-primary hover:underline" onClick={() => copy(cfg?.redirectUrl ?? '')}>
                {cfg?.redirectUrl} <Copy className="size-3.5" />
              </button>
            </li>
            <li>Copy the app&apos;s <strong>API Key</strong>. In the Angel One app enable <strong>TOTP</strong> and copy the secret key shown under the QR code.</li>
          </>
        ) : (
          <>
            <li>
              Open <strong>developers.kite.trade</strong> → <strong>Create new app</strong> (paid Kite Connect). Whitelist IP <code>{ip}</code>.
            </li>
            <li>
              Redirect URL:{' '}
              <button type="button" className="inline-flex items-center gap-1 font-mono text-primary hover:underline" onClick={() => copy(cfg?.redirectUrl ?? '')}>
                {cfg?.redirectUrl} <Copy className="size-3.5" />
              </button>
            </li>
            <li>Copy the app&apos;s <strong>API Key</strong> and <strong>API Secret</strong>.</li>
          </>
        )}
        <li>Fill the form below → <strong>Save</strong> → <strong>Test proxy health</strong> → <strong>Connect Broker</strong>.</li>
      </ol>
    </details>
  );
}

function BrokerForm({ broker }: { broker: BrokerSlug }) {
  const angel = broker === 'angel-one';
  const q = useBrokerApiConfig(broker);
  const { save, test, connect } = useBrokerApiMutations(broker);
  const accounts = useMyBrokerAccounts();
  const account = accounts.data?.find((a) => a.broker === (angel ? 'ANGEL_ONE' : 'ZERODHA'));
  const cfg = q.data;
  const blank = { clientCode: '', apiKey: '', apiSecret: '', pin: '', totpSecret: '', proxyHost: '', proxyPort: '', proxyUser: '', proxyPass: '' };
  const [f, setF] = useState(blank);
  const [autoLogin, setAutoLogin] = useState(true);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    setF({ ...blank, clientCode: cfg.clientCode ?? '', proxyHost: cfg.proxyHost ?? '', proxyPort: cfg.proxyPort ? String(cfg.proxyPort) : '' });
    setAutoLogin(cfg.autoLogin);
    setConsent(Boolean(cfg.consentAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.clientCode, cfg?.proxyHost, cfg?.proxyPort, cfg?.autoLogin, cfg?.consentAt]);

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const dirty = Object.entries(f).some(([k, v]) =>
    k === 'clientCode' ? v !== (cfg?.clientCode ?? '') : k === 'proxyHost' ? v !== (cfg?.proxyHost ?? '') : k === 'proxyPort' ? v !== (cfg?.proxyPort ? String(cfg.proxyPort) : '') : v !== '',
  );

  const doSave = () => {
    if (!consent) return toast.error('Please accept the consent to store your credentials');
    const body: SaveBrokerApiConfigInput = {
      ...(angel ? { clientCode: f.clientCode, pin: f.pin, totpSecret: f.totpSecret } : { clientCode: f.clientCode, apiSecret: f.apiSecret }),
      apiKey: f.apiKey,
      proxyHost: f.proxyHost,
      proxyPort: f.proxyPort ? Number(f.proxyPort) : undefined,
      proxyUser: f.proxyUser,
      proxyPass: f.proxyPass,
      autoLogin: angel ? autoLogin : undefined,
      consent: true,
    };
    save.mutate(body, {
      onSuccess: (v) => {
        setF((p) => ({ ...p, apiKey: '', apiSecret: '', pin: '', totpSecret: '', proxyUser: '', proxyPass: '' }));
        toast.success(v.complete ? 'Saved — now test proxy health and connect' : `Saved. Still missing: ${v.missing.map((m) => LABELS[m] ?? m).join(', ')}`);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const doConnect = () =>
    connect.mutate(undefined, {
      onSuccess: (r) => {
        if (r.loginUrl) {
          window.location.href = r.loginUrl;
          return;
        }
        toast.success(`${angel ? 'Angel One' : 'Zerodha'} connected through your static IP`);
      },
      onError: (e) => toast.error(e.message),
    });

  const missing = cfg?.missing.map((m) => LABELS[m] ?? m) ?? [];
  const canConnect = Boolean(cfg?.complete && cfg.consentAt) && !dirty;
  const connected = account?.status === 'CONNECTED' && account.tokenStatus === 'ACTIVE';

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-6 text-sm">
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Broker</span>
            {account ? <StatusBadge value={connected ? 'CONNECTED' : account.status} /> : <StatusBadge value="DISCONNECTED" label="Not connected" />}
            {account?.brokerClientId ? <span className="font-mono text-xs">{account.brokerClientId}</span> : null}
          </span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Proxy</span>
            {cfg?.lastTest ? (
              cfg.lastTest.ok ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-4" /> OK · {cfg.lastTest.ip}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <XCircle className="size-4" /> Failed
                </span>
              )
            ) : (
              <span className="text-muted-foreground">Not tested</span>
            )}
          </span>
          {cfg?.lastLogin.at ? <span className="text-muted-foreground">Last login {formatDateTime(cfg.lastLogin.at)}</span> : null}
          {cfg?.lastLogin.error ? <span className="text-destructive">Last error: {cfg.lastLogin.error}</span> : null}
        </CardContent>
      </Card>

      <SetupSteps broker={broker} cfg={cfg} />

      <Card>
        <CardHeader>
          <CardTitle>{angel ? 'Angel One API' : 'Zerodha API'}</CardTitle>
          <CardDescription>Your credentials are encrypted and never shown again — not even to the admin. Leave a saved field blank to keep it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              doSave();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <F id={`${broker}-cc`} label={angel ? 'Client Code' : 'User ID (optional)'} required={angel} value={f.clientCode} onChange={set('clientCode')} />
              <F id={`${broker}-key`} label="API Key" required secret saved={cfg?.saved.apiKey} value={f.apiKey} onChange={set('apiKey')} />
              {angel ? (
                <>
                  <F id={`${broker}-pin`} label="PIN" required secret saved={cfg?.saved.pin} value={f.pin} onChange={set('pin')} inputMode="numeric" />
                  <F
                    id={`${broker}-totp`}
                    label="TOTP secret (QR code key)"
                    required
                    secret
                    saved={cfg?.saved.totpSecret}
                    value={f.totpSecret}
                    onChange={set('totpSecret')}
                    hint="The key under the QR code when enabling TOTP (or the otpauth:// link)"
                  />
                </>
              ) : (
                <F id={`${broker}-secret`} label="API Secret" required secret saved={cfg?.saved.apiSecret} value={f.apiSecret} onChange={set('apiSecret')} />
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <F id={`${broker}-host`} label="Static IP" required value={f.proxyHost} onChange={set('proxyHost')} hint="Proxy IP or host, e.g. 103.25.10.20" />
              <F id={`${broker}-port`} label="Port" required value={f.proxyPort} onChange={set('proxyPort')} inputMode="numeric" type="text" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <F id={`${broker}-pu`} label="Proxy Login ID" secret saved={cfg?.saved.proxyUser} value={f.proxyUser} onChange={set('proxyUser')} />
              <F id={`${broker}-pp`} label="Proxy Password" secret saved={cfg?.saved.proxyPass} value={f.proxyPass} onChange={set('proxyPass')} />
            </div>

            {angel ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={autoLogin} onChange={(e) => setAutoLogin(e.target.checked)} />
                <span>
                  <strong>Auto-login every trading morning</strong> (around 8:45 AM IST) with my PIN + TOTP, so I don&apos;t have to connect daily.
                </span>
              </label>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                I authorise this platform to store my broker API credentials (encrypted) and to log in and place copy-trading orders in my account through my
                static IP.
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div>
                <p className="font-medium">Static IP proxy health</p>
                <p className="text-sm text-muted-foreground">
                  {cfg?.lastTest
                    ? cfg.lastTest.ok
                      ? `Working — brokers will see ${cfg.lastTest.ip}${cfg.latencyMs ? ` · ${cfg.latencyMs} ms` : ''} · ${formatDateTime(cfg.lastTest.at)}`
                      : (cfg.lastTest.error ?? 'Failed')
                    : 'Save, then test that the proxy works and which IP the broker will see.'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending || !cfg?.proxyHost || dirty}
                onClick={() =>
                  test.mutate(undefined, {
                    onSuccess: (v) => (v.lastTest?.ok ? toast.success(`Proxy OK — ${v.lastTest.ip}`) : toast.error(v.lastTest?.error ?? 'Proxy test failed')),
                    onError: (e) => toast.error(e.message),
                  })
                }
              >
                <Activity /> {test.isPending ? 'Testing…' : 'Test proxy health'}
              </Button>
            </div>

            <div className="flex gap-2 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium">Important</p>
                <p className="text-muted-foreground">
                  Broker sessions expire every day. {angel ? 'With auto-login ON we reconnect you each trading morning; if it fails, press Connect Broker before 9:15 AM.' : 'Zerodha requires a browser login — press Connect Broker every trading day before 9:15 AM.'}{' '}
                  Orders are only accepted from the static IP registered with your broker.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" disabled={save.isPending}>
                <ShieldCheck /> {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" disabled={!canConnect || connect.isPending} onClick={doConnect}>
                <Link2 /> {connect.isPending ? 'Connecting…' : connected ? 'Reconnect Broker' : 'Connect Broker'}
              </Button>
              <span className={cn('text-xs', canConnect ? 'text-muted-foreground' : 'text-warning')}>
                {dirty
                  ? 'Save your changes first'
                  : missing.length
                    ? `Missing: ${missing.join(', ')}`
                    : !cfg?.consentAt
                      ? 'Accept the consent and save'
                      : angel
                        ? 'Connects instantly with PIN + TOTP'
                        : 'Opens the Kite login page'}
              </span>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BrokerApiPage() {
  const [tab, setTab] = useState<BrokerSlug>('angel-one');
  return (
    <>
      <PageHeader title="Broker API" description="Connect your own broker API app through your static IP — required for live copy trading." />
      <div className="mb-4 inline-flex overflow-hidden rounded-lg border" role="tablist" aria-label="Broker">
        {(
          [
            ['angel-one', 'Angel One'],
            ['zerodha', 'Zerodha'],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={cn('px-5 py-2 text-sm font-medium transition-colors', tab === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
          >
            {l}
          </button>
        ))}
      </div>
      <BrokerForm key={tab} broker={tab} />
    </>
  );
}
