import { Badge, type BadgeProps } from '@/components/ui/badge';
import { humanize } from '@/lib/format';

type Variant = NonNullable<BadgeProps['variant']>;

const MAP: Record<string, Variant> = {
  // users / accounts
  ACTIVE: 'success',
  DISABLED: 'destructive',
  CONNECTED: 'success',
  PENDING: 'warning',
  EXPIRED: 'warning',
  DISCONNECTED: 'secondary',
  ERROR: 'destructive',
  NONE: 'secondary',
  // strategy / copy
  DRAFT: 'secondary',
  PAUSED: 'warning',
  ARCHIVED: 'secondary',
  ON: 'success',
  OFF: 'secondary',
  // orders
  SUBMITTED: 'default',
  OPEN: 'default',
  PARTIALLY_FILLED: 'warning',
  FILLED: 'success',
  CANCELLED: 'secondary',
  REJECTED: 'destructive',
  FAILED: 'destructive',
  UNKNOWN: 'warning',
  // sides
  BUY: 'success',
  SELL: 'destructive',
  // severity
  INFO: 'secondary',
  WARNING: 'warning',
  CRITICAL: 'destructive',
  // roles
  ADMIN: 'default',
  MASTER: 'default',
  FOLLOWER: 'secondary',
};

export function StatusBadge({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={MAP[value] ?? 'outline'}>{label ?? humanize(value)}</Badge>;
}
