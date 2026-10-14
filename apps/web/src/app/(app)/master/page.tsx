'use client';

import { useEffect, useState } from 'react';
import { LogOut, Pause, Pencil, Play, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { StrategyView } from '@ctp/types';
import { ExitButton, LiveAccountCard, PaperPositionsCard, Pnl } from '@/components/live-account';
import { MarketFeedPanel } from '@/components/market-feed-panel';
import { SignalForm, SignalsCard } from '@/components/signal-desk';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { brokerLabel, formatDateTime, formatINR, humanize } from '@/lib/format';
import {
  type StrategyInput,
  useAssignClient,
  useClientLive,
  useRemoveClient,
  useMasterLive,
  useMasterStrategies,
  useMasterTrade,
  useMasterTrades,
  useSaveStrategy,
  useStrategyFollowers,
  useStrategyStatus,
  useExitStrategy,
} from '@/lib/trading';

const EXCHANGES = ['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS', 'BCD'];
const optNum = (v: string) => (v.trim() === '' ? undefined : Number(v));

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- strategy form
function StrategyDialog({ open, onOpenChange, strategy }: { open: boolean; onOpenChange: (o: boolean) => void; strategy?: StrategyView | null }) {
  const save = useSaveStrategy();
  const [f, setF] = useState({ name: '', description: '', riskLevel: 'MEDIUM', exchanges: [] as string[], instruments: '', masterCapital: '', maxFollowers: '', maxOrderValue: '', maxQty: '' });
  useEffect(() => {
    if (!open) return;
    const s = strategy;
    setF({
      name: s?.name ?? '',
      description: s?.description ?? '',
      riskLevel: s?.riskLevel ?? 'MEDIUM',
      exchanges: s?.allowedExchanges ?? ['NSE'],
      instruments: (s?.allowedInstruments ?? []).join(', '),
      masterCapital: s ? String(Number(s.masterCapital)) : '',
      maxFollowers: s?.maxFollowers ? String(s.maxFollowers) : '',
      maxOrderValue: '',
      maxQty: '',
    });
  }, [open, strategy]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{strategy ? 'Edit strategy' : 'New strategy'}</DialogTitle>
          <DialogDescription>Clients follow a strategy and every trade you place in it is copied to them.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const body: StrategyInput = {
              name: f.name,
              description: f.description || undefined,
              riskLevel: f.riskLevel as StrategyInput['riskLevel'],
              allowedExchanges: f.exchanges,
              allowedInstruments: f.instruments.split(',').map((x) => x.trim()).filter(Boolean),
              masterCapital: Number(f.masterCapital || 0),
              maxFollowers: optNum(f.maxFollowers),
              maxOrderValue: optNum(f.maxOrderValue),
              maxQuantityPerOrder: optNum(f.maxQty),
            };
            save.mutate(
              { id: strategy?.id, body },
              { onSuccess: () => (toast.success('Strategy saved'), onOpenChange(false)), onError: (err) => toast.error(err.message) },
            );
          }}
        >
          <Field label="Name">
            <Input value={f.name} onChange={set('name')} required minLength={2} />
          </Field>
          <Field label="Description">
            <Textarea value={f.description} onChange={set('description')} rows={2} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Risk level">
              <Select value={f.riskLevel} onChange={set('riskLevel')}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </Select>
            </Field>
            <Field label="Your capital (₹)" hint="Basis for proportional allocation">
              <Input type="number" min={0} value={f.masterCapital} onChange={set('masterCapital')} required />
            </Field>
          </div>
          <Field label="Allowed exchanges">
            <div className="flex flex-wrap gap-2">
              {EXCHANGES.map((x) => {
                const on = f.exchanges.includes(x);
                return (
                  <Button
                    key={x}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    onClick={() => setF((p) => ({ ...p, exchanges: on ? p.exchanges.filter((y) => y !== x) : [...p.exchanges, x] }))}
                  >
                    {x}
                  </Button>
                );
              })}
            </div>
          </Field>
          <Field label="Allowed symbols (optional)" hint="Comma separated, * as wildcard — e.g. NIFTY*, BANKNIFTY*, RELIANCE">
            <Input value={f.instruments} onChange={set('instruments')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Max clients">
              <Input type="number" min={1} value={f.maxFollowers} onChange={set('maxFollowers')} />
            </Field>
            <Field label="Max order value ₹">
              <Input type="number" min={0} value={f.maxOrderValue} onChange={set('maxOrderValue')} />
            </Field>
            <Field label="Max qty / order">
              <Input type="number" min={1} value={f.maxQty} onChange={set('maxQty')} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- followers
function ClientDialog({ userId, name, onClose }: { userId: string | null; name?: string; onClose: () => void }) {
  const q = useClientLive(userId);
  return (
    <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{name ?? 'Client'}</DialogTitle>
          <DialogDescription>Live broker data for this client. Use Exit to close a running position at MARKET.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {q.error ? <p className="text-sm text-destructive">{q.error.message}</p> : null}
        <div className="grid gap-4">
          {q.data?.live.map((a) => <LiveAccountCard key={a.accountId} a={a} canExit clientUserId={userId ?? undefined} />)}
          {q.data && q.data.paperPositions.length > 0 ? <PaperPositionsCard rows={q.data.paperPositions} canExit clientUserId={userId ?? undefined} /> : null}
          {q.data && q.data.live.length === 0 && q.data.paperPositions.length === 0 ? (
            <p className="text-sm text-muted-foreground">This client has no connected broker yet.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignClientDialog({ strategy, open, onOpenChange }: { strategy: StrategyView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const assign = useAssignClient(strategy.id);
  const empty = { email: '', allocationMode: 'FIXED_QUANTITY' as const, value: '', maxDailyLoss: '', startCopy: true };
  const [f, setF] = useState<{ email: string; allocationMode: 'FIXED_QUANTITY' | 'CAPITAL_PERCENTAGE' | 'PROPORTIONAL'; value: string; maxDailyLoss: string; startCopy: boolean }>(empty);
  useEffect(() => {
    if (open) setF(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const valueLabel = f.allocationMode === 'FIXED_QUANTITY' ? 'Quantity per trade' : f.allocationMode === 'CAPITAL_PERCENTAGE' ? '% of master quantity' : 'Client capital (₹)';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(f.value);
    if (!f.email.trim() || !(v > 0)) return toast.error('Email and a positive allocation value are required');
    assign.mutate(
      {
        email: f.email.trim(),
        allocationMode: f.allocationMode,
        fixedQuantity: f.allocationMode === 'FIXED_QUANTITY' ? Math.round(v) : undefined,
        allocationPercent: f.allocationMode === 'CAPITAL_PERCENTAGE' ? v : undefined,
        allocationAmount: f.allocationMode === 'PROPORTIONAL' ? v : undefined,
        maxDailyLoss: f.maxDailyLoss ? Number(f.maxDailyLoss) : undefined,
        startCopy: f.startCopy,
      },
      {
        onSuccess: (r) => {
          if (r.warning) toast.warning(r.warning);
          else toast.success(`Client assigned to ${strategy.name}`);
          onOpenChange(false);
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
            <DialogTitle>Assign client · {strategy.name}</DialogTitle>
            <DialogDescription>The client must already have an account (role: client). Their connected broker account is used.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-email">Client email</Label>
            <Input id="assign-email" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="assign-mode">Allocation</Label>
              <Select id="assign-mode" value={f.allocationMode} onChange={(e) => setF({ ...f, allocationMode: e.target.value as typeof f.allocationMode, value: '' })}>
                <option value="FIXED_QUANTITY">Fixed quantity</option>
                <option value="CAPITAL_PERCENTAGE">% of master qty</option>
                <option value="PROPORTIONAL">Capital based</option>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="assign-value">{valueLabel}</Label>
              <Input id="assign-value" type="number" min="0" step="any" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-loss">Max daily loss (₹, optional)</Label>
            <Input id="assign-loss" type="number" min="0" step="any" inputMode="decimal" value={f.maxDailyLoss} onChange={(e) => setF({ ...f, maxDailyLoss: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={f.startCopy} onChange={(e) => setF({ ...f, startCopy: e.target.checked })} />
            Start copying now (only if the client&apos;s broker is connected)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={assign.isPending}>
              {assign.isPending ? 'Assigning…' : 'Assign client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FollowersCard({ strategy }: { strategy: StrategyView }) {
  const q = useStrategyFollowers(strategy.id);
  const remove = useRemoveClient(strategy.id);
  const [client, setClient] = useState<{ id: string; name?: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  return (
    <Card id="clients" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Clients · {strategy.name}</CardTitle>
            <CardDescription>Who follows this strategy, their broker status and allocation.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setAssignOpen(true)}>
            <Plus /> Assign client
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Broker</TableHead>
              <TableHead>Allocation</TableHead>
              <TableHead>Copying</TableHead>
              <TableHead className="text-right">Paper P&amp;L</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  {q.isLoading ? 'Loading…' : 'No clients yet'}
                </TableCell>
              </TableRow>
            ) : (
              q.data!.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <div className="font-medium">{f.followerName}</div>
                    <div className="text-xs text-muted-foreground">{f.followerEmail}</div>
                  </TableCell>
                  <TableCell>
                    {f.brokerAccount ? (
                      <div className="flex flex-col gap-1">
                        <span>
                          {brokerLabel(f.brokerAccount.broker)} <span className="text-xs text-muted-foreground">{f.brokerAccount.brokerClientId}</span>
                        </span>
                        <StatusBadge value={f.brokerAccount.tokenStatus === 'ACTIVE' ? 'CONNECTED' : f.brokerAccount.status} />
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {f.allocationMode === 'FIXED_QUANTITY'
                      ? `${f.fixedQuantity} qty`
                      : f.allocationMode === 'CAPITAL_PERCENTAGE'
                        ? `${Number(f.allocationPercent)}% of your qty`
                        : `${formatINR(f.allocationAmount)} capital`}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={f.copyStatus} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Pnl value={Number(f.paperRealizedPnl) + Number(f.paperUnrealizedPnl)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setClient({ id: f.followerUserId, name: f.followerName })}>
                        View / exit
                      </Button>
                      {f.copyStatus !== 'OFF' ? (
                        <ExitButton
                          label="Remove"
                          pending={remove.isPending && remove.variables === f.id}
                          onConfirm={() =>
                            remove.mutate(f.id, {
                              onSuccess: () => toast.success(`${f.followerName ?? 'Client'} removed — copying stopped`),
                              onError: (err) => toast.error(err.message),
                            })
                          }
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      <ClientDialog userId={client?.id ?? null} name={client?.name} onClose={() => setClient(null)} />
      <AssignClientDialog strategy={strategy} open={assignOpen} onOpenChange={setAssignOpen} />
    </Card>
  );
}

// ---------------------------------------------------------------- trades
function TradeDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useMasterTrade(id);
  const t = q.data;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t ? `${t.side} ${t.quantity} ${t.symbol}` : 'Trade'}</DialogTitle>
          <DialogDescription>{t ? `${t.exchange} · ${humanize(t.productType)} · ${formatDateTime(t.eventTimestamp)}` : ''}</DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Avg</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(t?.copyOrders ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  No clients were copying when this trade happened.
                </TableCell>
              </TableRow>
            ) : (
              t!.copyOrders.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.followerName}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(c.averagePrice)}</TableCell>
                  <TableCell>
                    <StatusBadge value={c.status} />
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={c.errorMessage ?? ''}>
                    {c.errorMessage ?? (c.brokerOrderId ? `Order ${c.brokerOrderId}` : '')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

function TradesCard() {
  const q = useMasterTrades();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card id="order-log" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Order log</CardTitle>
        <CardDescription>Every entry and exit (placed here, auto TP/SL, or detected in your broker app) and how it was copied to each client.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Trade</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Copied</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  {q.isLoading ? 'Loading…' : 'No trades yet'}
                </TableCell>
              </TableRow>
            ) : (
              q.data!.map((t) => {
                const c = t.copyStatusCounts;
                const ok = (c.FILLED ?? 0) + (c.SUBMITTED ?? 0);
                const bad = (c.FAILED ?? 0) + (c.REJECTED ?? 0);
                return (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpen(t.id)}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateTime(t.eventTimestamp)}</TableCell>
                    <TableCell>
                      <span className={t.side === 'BUY' ? 'text-success' : 'text-destructive'}>{t.side}</span> {t.quantity} <span className="font-medium">{t.symbol}</span>{' '}
                      <span className="text-xs text-muted-foreground">{t.exchange}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(t.averagePrice ?? t.price)}</TableCell>
                    <TableCell>
                      <StatusBadge value={t.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {ok} ok{bad ? <span className="text-destructive"> · {bad} failed</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
      <TradeDialog id={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

// ---------------------------------------------------------------- page
export default function MasterDeskPage() {
  const strategies = useMasterStrategies();
  const live = useMasterLive();
  const status = useStrategyStatus();
  const exitAll = useExitStrategy();
  const [exitTarget, setExitTarget] = useState<StrategyView | null>(null);
  const [edit, setEdit] = useState<{ open: boolean; s?: StrategyView | null }>({ open: false });
  const [selected, setSelected] = useState<string | null>(null);
  const list = strategies.data ?? [];
  const sel = list.find((s) => s.id === selected) ?? list[0];

  return (
    <>
      <PageHeader
        title="Master desk"
        description="Your strategies, clients, live account and trades."
        actions={
          <Button onClick={() => setEdit({ open: true, s: null })}>
            <Plus /> New strategy
          </Button>
        }
      />
      {live.data?.paperMode ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <strong>Paper mode is ON</strong> — no real orders are sent to any broker. Trades are simulated at the given/live price.
        </p>
      ) : null}

      <div className="grid gap-4">
        <MarketFeedPanel />
        <Card id="strategies" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Strategies</CardTitle>
            <CardDescription>Start a strategy to trade it; pause to stop copying to all its clients.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead className="text-right">Capital</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      {strategies.isLoading ? 'Loading…' : 'No strategies yet — create your first one.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  list.map((s) => (
                    <TableRow key={s.id} data-state={sel?.id === s.id ? 'selected' : undefined}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {humanize(s.riskLevel)} risk · {s.allowedExchanges.join(', ') || 'All exchanges'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={s.status} />
                      </TableCell>
                      <TableCell>
                        {s.activeFollowerCount ?? 0} copying / {s.followerCount ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(s.masterCapital)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Clients" onClick={() => setSelected(s.id)}>
                            <Users />
                          </Button>
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => setEdit({ open: true, s })}>
                            <Pencil />
                          </Button>
                          <Button size="sm" variant="ghost" title="Exit all client positions" onClick={() => setExitTarget(s)}>
                            <LogOut />
                          </Button>
                          {s.status === 'ACTIVE' ? (
                            <Button size="sm" variant="outline" disabled={status.isPending} onClick={() => status.mutate({ id: s.id, status: 'PAUSED' }, { onError: (e) => toast.error(e.message) })}>
                              <Pause /> Pause
                            </Button>
                          ) : (
                            <Button size="sm" disabled={status.isPending} onClick={() => status.mutate({ id: s.id, status: 'ACTIVE' }, { onError: (e) => toast.error(e.message) })}>
                              <Play /> Start
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <SignalForm strategies={list} />
        <SignalsCard />
        {sel ? <FollowersCard strategy={sel} /> : null}

        <TradesCard />

        <h2 id="positions" className="mt-2 scroll-mt-20 text-lg font-semibold">My broker account</h2>
        {live.isLoading ? <p className="text-sm text-muted-foreground">Loading live data…</p> : null}
        {live.data && live.data.live.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connect Zerodha or Angel One from the Dashboard to see live data.</p>
        ) : null}
        {live.data?.live.map((a) => <LiveAccountCard key={a.accountId} a={a} />)}
        {live.data && live.data.paperPositions.length > 0 ? <PaperPositionsCard rows={live.data.paperPositions} title="My signal book (virtual)" canExit signalBook /> : null}
      </div>

      <Dialog open={!!exitTarget} onOpenChange={(o) => !o && setExitTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exit strategy · {exitTarget?.name}?</DialogTitle>
            <DialogDescription>
              Squares off every OPEN signal of this strategy (moves them to Closed history) and places MARKET exits for any copy position still open in
              client accounts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExitTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={exitAll.isPending}
              onClick={() =>
                exitTarget &&
                exitAll.mutate(exitTarget.id, {
                  onSuccess: (r) => (
                    toast.success(`${r.signalsClosed ?? 0} signal(s) closed · ${r.orders} extra exit order(s)${r.failed ? ` · ${r.failed} failed` : ''}`),
                    setExitTarget(null)
                  ),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              {exitAll.isPending ? 'Exiting…' : 'Exit all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <StrategyDialog open={edit.open} strategy={edit.s} onOpenChange={(o) => setEdit((p) => ({ ...p, open: o }))} />
    </>
  );
}
