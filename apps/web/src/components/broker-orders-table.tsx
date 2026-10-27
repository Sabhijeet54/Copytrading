'use client';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { brokerLabel, formatDateTime, formatINR, humanize } from '@/lib/format';
import type { BrokerStatus, CopyOrderRow } from '@/lib/trading';

type Variant = NonNullable<BadgeProps['variant']>;

/** Broker execution status labels. "Executed" only for a fill the broker confirmed. */
const STATUS: Record<BrokerStatus, { label: string; variant: Variant }> = {
  PAPER: { label: 'Paper · not sent', variant: 'secondary' },
  NOT_SENT: { label: 'Not sent · no broker', variant: 'warning' },
  SKIPPED: { label: 'Skipped', variant: 'secondary' },
  EXECUTED: { label: 'Executed / Filled', variant: 'success' },
  FILLED: { label: 'Executed / Filled', variant: 'success' },
  PARTIALLY_FILLED: { label: 'Partially filled', variant: 'warning' },
  PENDING: { label: 'Pending', variant: 'warning' },
  SUBMITTED: { label: 'Submitted', variant: 'default' },
  OPEN: { label: 'Open at broker', variant: 'default' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'secondary' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  UNKNOWN: { label: 'Unknown', variant: 'warning' },
};

function statusOf(o: CopyOrderRow): BrokerStatus {
  if (o.brokerStatus) return o.brokerStatus;
  if (o.errorCode === 'MISSED' || o.errorCode === 'NOT_SENT') return 'NOT_SENT';
  return (o.status as BrokerStatus) ?? 'UNKNOWN';
}

function note(o: CopyOrderRow, st: BrokerStatus): string {
  if (o.errorMessage) return o.errorMessage;
  if (st === 'PAPER') return 'Simulated in the software — no broker order.';
  if (st === 'NOT_SENT') return 'Broker execution not attempted — no valid broker connection.';
  return '';
}

/**
 * Orders section: the actual broker execution of every order the software created for a strategy trade.
 * Linked to the Positions tab by Strategy Trade ID.
 */
export function BrokerOrdersTable({ rows, empty }: { rows: CopyOrderRow[]; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Trade ID</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Broker status</TableHead>
            <TableHead className="text-right">Filled · exec. price</TableHead>
            <TableHead>Broker · order ID</TableHead>
            <TableHead>Reason / message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((o) => {
              const st = statusOf(o);
              const s = STATUS[st] ?? { label: humanize(st), variant: 'outline' as Variant };
              const sentToBroker = st !== 'PAPER' && st !== 'NOT_SENT' && st !== 'SKIPPED';
              return (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(o.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground" title={o.strategyTradeId ?? ''}>
                    {o.strategyTradeRef ?? '—'}
                    {o.isExit ? <span className="block font-sans text-[10px]">exit</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {o.strategyName ?? '—'}
                    {o.mode ? <span className="block text-[10px] text-muted-foreground">{o.mode === 'LIVE' ? 'Live mode' : 'Paper mode'}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className={o.side === 'BUY' ? 'text-success' : 'text-destructive'}>{o.side}</span> {o.quantity} <span className="font-medium">{o.symbol}</span>{' '}
                    <span className="text-xs text-muted-foreground">{o.exchange}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {humanize(o.orderType)} · {humanize(o.productType)}
                      {o.price && o.orderType !== 'MARKET' ? ` @ ${formatINR(o.price)}` : o.orderType === 'MARKET' ? ' · market price' : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {sentToBroker ? (
                      <>
                        {o.filledQuantity}/{o.quantity}
                        <span className="block text-xs text-muted-foreground">{o.filledQuantity > 0 ? formatINR(o.averagePrice) : '—'}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {sentToBroker ? (
                      <>
                        {brokerLabel(o.brokerName ?? o.broker)}
                        <span className="block font-mono text-muted-foreground">{o.brokerOrderId ?? '—'}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-56 max-w-80 whitespace-normal text-xs text-muted-foreground" title={note(o, st)}>
                    {note(o, st)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
