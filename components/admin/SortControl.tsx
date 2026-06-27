"use client";

import { ArrowUpDown } from "lucide-react";

export interface SortOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Shared premium sort control (used on Payments & Lead CRM). A compact, mobile-
 * friendly labelled dropdown styled to match the admin UI. Display-only — the
 * parent owns the value (persisted via usePersistentState) and the actual sort.
 */
export default function SortControl<T extends string>({
  value,
  onChange,
  options,
  label = "Sort",
}: {
  value: T;
  onChange: (v: T) => void;
  options: SortOption<T>[];
  label?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-soft">
      <ArrowUpDown size={15} className="shrink-0 text-muted" />
      <span className="hidden text-xs font-medium text-muted sm:inline">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer border-0 bg-transparent pr-1 text-sm font-semibold text-ink outline-none"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
