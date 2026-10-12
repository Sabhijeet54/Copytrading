import { AlertTriangle, Inbox } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

export function TableLoading({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <TableCell key={c}>
              <Skeleton className="h-4 w-full max-w-32" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function TableEmpty({ cols, message }: { cols: number; message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={cols} className="py-12 text-center text-sm text-muted-foreground">
        <Inbox className="mx-auto mb-2 size-6 opacity-60" />
        {message}
      </TableCell>
    </TableRow>
  );
}

export function TableError({ cols, error }: { cols: number; error: unknown }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={cols} className="py-10 text-center text-sm text-destructive">
        <AlertTriangle className="mx-auto mb-2 size-5" />
        {error instanceof Error ? error.message : 'Something went wrong'}
      </TableCell>
    </TableRow>
  );
}
