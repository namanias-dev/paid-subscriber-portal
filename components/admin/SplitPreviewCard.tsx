"use client";

import Link from "next/link";

export interface SplitRow {
  key: string;
  label: string;
  count: number;
  color?: string;
}

/**
 * Premium collapsed mini-card that previews a labelled split (top few rows with
 * mini-bars + a tasteful "+N more") and links to the full-page view. Purely
 * presentational — the caller supplies pre-sorted rows whose counts already use
 * the paid-only + distinct methodology, so the preview matches the opened view.
 * Overflow-safe at 320px (labels truncate, bars flex, values are fixed-width).
 */
export default function SplitPreviewCard({
  label,
  href,
  rows,
  total,
  maxRows = 6,
  hint,
  emptyText = "No registrations in the last 7 days.",
}: {
  label: string;
  href: string;
  rows: SplitRow[];
  total: number;
  maxRows?: number;
  hint?: string;
  emptyText?: string;
}) {
  const shown = rows.slice(0, maxRows);
  const more = Math.max(0, rows.length - shown.length);
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <Link
      href={href}
      className="card block p-4 hover:shadow-md motion-reduce:transition-none"
      title="Open full view"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        <span className="ml-auto shrink-0 text-xs font-semibold text-primary">View →</span>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold leading-none tabular-nums">{total}</span>
        {hint && <span className="truncate text-[11px] text-muted">{hint}</span>}
      </div>

      {total === 0 ? (
        <p className="mt-3 text-xs text-muted">{emptyText}</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {shown.map((r) => {
            const color = r.color || "#0057FF";
            return (
              <div key={r.key} className="flex items-center gap-2">
                <span className="flex min-w-0 basis-[42%] items-center gap-1.5 sm:basis-[32%]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
                  <span className="truncate text-xs font-medium text-ink">{r.label}</span>
                </span>
                <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface2" aria-hidden="true">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max((r.count / max) * 100, 3)}%`, background: color }} />
                </span>
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink2">{r.count}</span>
              </div>
            );
          })}
          {more > 0 && (
            <p className="pt-0.5 text-[11px] font-medium text-muted">+{more} more</p>
          )}
        </div>
      )}
    </Link>
  );
}
