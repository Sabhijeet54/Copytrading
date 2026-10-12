import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  loading,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'success' | 'destructive';
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span className="[&_svg]:size-4">{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-16" />
      ) : (
        <div
          className={cn(
            'tabular mt-2 text-2xl font-semibold',
            tone === 'success' && 'text-success',
            tone === 'destructive' && 'text-destructive',
          )}
        >
          {value}
        </div>
      )}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
