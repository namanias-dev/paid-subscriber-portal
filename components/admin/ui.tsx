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
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "blue" | "green" | "amber" | "red";
}) {
  const ring: Record<string, string> = {
    blue: "var(--primary)",
    green: "var(--success)",
    amber: "var(--warning)",
    red: "var(--danger)",
  };
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <span className="h-2 w-2 rounded-full" style={{ background: ring[tone] }} />
      </div>
      <p className="mt-2 font-heading text-2xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function useAdminData<T>(url: string, key: string): { data: T | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then((d) => setData(d[key] ?? null))
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
