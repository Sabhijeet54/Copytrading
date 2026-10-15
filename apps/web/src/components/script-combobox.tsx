'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { FnoScript } from '@/lib/trading';
import { cn } from '@/lib/utils';

/**
 * Script search box with a dropdown: type "R" → every F&O script starting with R (lot size + next expiry).
 * Arrow keys / Enter / click to pick. Free text still works (e.g. cash-market stocks).
 */
export function ScriptCombobox({
  id,
  value,
  onChange,
  options,
  loading,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: FnoScript[] | null;
  loading?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setHi(0), [value]);
  const list = options ?? [];
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };
  return (
    <div ref={box} className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onFocus={() => options && setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          if (options) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, list.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
          else if (e.key === 'Enter') (e.preventDefault(), pick(list[hi]!.name));
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && options ? (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card p-1 shadow-lg">
          {list.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{loading ? 'Loading list…' : 'No F&O script starts with this'}</li>
          ) : (
            list.map((o, i) => (
              <li
                key={o.name}
                role="option"
                aria-selected={i === hi}
                onMouseDown={(e) => (e.preventDefault(), pick(o.name))}
                onMouseEnter={() => setHi(i)}
                className={cn('flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-1.5 text-sm', i === hi && 'bg-muted', o.name === value && 'font-semibold')}
              >
                <span>{o.name}</span>
                <span className="text-xs text-muted-foreground">
                  lot {o.lotSize}
                  {o.nearestExpiry ? ` · ${o.nearestExpiry}` : ''}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
