import { Select } from '@/components/ui/select';
import { humanize } from '@/lib/format';

export function EnumSelect({
  value,
  onChange,
  options,
  allLabel = 'All',
  labels,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  allLabel?: string;
  labels?: (v: string) => string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels ? labels(o) : humanize(o)}
        </option>
      ))}
    </Select>
  );
}
