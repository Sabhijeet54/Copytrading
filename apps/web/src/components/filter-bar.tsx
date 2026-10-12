import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function FilterBar({ children, onReset, active }: { children: React.ReactNode; onReset?: () => void; active?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b p-3">
      {children}
      {onReset && active ? (
        <Button variant="ghost" size="sm" onClick={onReset} className="h-9">
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className ?? 'grid w-40 gap-1.5'}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
