import { toast } from 'sonner';
import type { ResizeResult } from './trading';

/** Tells the user which already-booked (open) trades were resized to the new lot multiplier. */
export function toastResized(resized: ResizeResult[] | undefined) {
  const done = (resized ?? []).filter((x) => x.ok);
  const bad = (resized ?? []).filter((x) => !x.ok);
  if (done.length) toast.success(`Open trades resized: ${done.map((x) => `${x.symbol} ${x.from} → ${x.to} qty`).join(', ')}`);
  for (const b of bad) toast.error(`${b.symbol}: open trade not resized — ${b.error ?? 'error'}`);
}
