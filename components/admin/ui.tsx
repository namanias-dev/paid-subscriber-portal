"use client";

import { useEffect, useState, useCallback } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone = "blue",
  title,
  onClick,
  selected,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "blue" | "green" | "amber" | "red";
  /** Native tooltip explaining the metric's scope (e.g. which money it counts). */
  title?: string;
  /** When provided, the card becomes an interactive filter toggle (button). */
  onClick?: () => void;
  /** Renders the selected/active ring when this card's filter is applied. */
  selected?: boolean;
}) {
  const ring: Record<string, string> = {
    blue: "var(--primary)",
    green: "var(--success)",
    amber: "var(--warning)",
    red: "var(--danger)",
  };
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <span className="h-2 w-2 rounded-full" style={{ background: ring[tone] }} />
      </div>
      <p className="mt-2 font-heading text-2xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={selected}
        className="card cursor-pointer p-5 text-left transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40"
        style={selected ? { boxShadow: `0 0 0 2px ${ring[tone]}`, borderColor: ring[tone] } : undefined}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="card p-5" title={title}>
      {inner}
    </div>
  );
}

/**
 * In-flight GET de-duplication. Several `useAdminData` hooks on one page often read
 * DIFFERENT keys from the SAME endpoint (e.g. the Payments page has 7 hooks all
 * hitting /api/admin/payments). Without this, each hook fired its own request, so
 * that heavy route ran 7× per page load. Here concurrent requests to the same URL
 * share ONE fetch+parse promise; the entry is dropped as soon as it settles, so a
 * later reload() (e.g. after a mutation) always fetches fresh — never stale money.
 */
const inflightGet = new Map<string, Promise<unknown>>();

function dedupedFetchJson(url: string): Promise<unknown> {
  const existing = inflightGet.get(url);
  if (existing) return existing;
  const p = fetch(url)
    .then((r) => r.json())
    .finally(() => { inflightGet.delete(url); });
  inflightGet.set(url, p);
  return p;
}

export function useAdminData<T>(url: string, key: string): { data: T | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    dedupedFetchJson(url)
      .then((d) => setData(((d as Record<string, T> | null)?.[key]) ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [url, key]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, reload };
}

export function TableShell({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function LoadingBlock() {
  return <div className="skeleton h-48 w-full animate-shimmer" />;
}
