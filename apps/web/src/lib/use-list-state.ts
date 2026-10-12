'use client';

import { useCallback, useMemo, useState } from 'react';

export type Filters = Record<string, string>;

/** Filter + pagination state for admin tables. Changing a filter resets to page 1. */
export function useListState<F extends Filters>(initial: F, pageSize = 25) {
  const [filters, setFilters] = useState<F>(initial);
  const [page, setPage] = useState(1);

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }, []);

  const reset = useCallback(() => {
    setFilters(initial);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const params = useMemo(() => {
    const out: Record<string, string | number> = { page, pageSize };
    for (const [k, v] of Object.entries(filters)) if (v) out[k] = v;
    return out;
  }, [filters, page, pageSize]);

  const active = Object.values(filters).some(Boolean);
  return { filters, setFilter, page, setPage, pageSize, params, reset, active };
}

/** Converts a YYYY-MM-DD date picked in the UI into IST day bounds for the API. */
export function istDayStart(date: string): string | undefined {
  return date ? `${date}T00:00:00+05:30` : undefined;
}
export function istDayEndExclusive(date: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
