"use client";

import { useEffect, useState } from "react";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`aiva-card aiva-card-pad ${className}`}>{children}</div>;
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="aiva-kpi">
      <div className="aiva-label">{label}</div>
      <div className="mt-1 font-heading text-2xl font-bold text-white">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-heading text-lg font-bold text-white">{children}</h2>
      {sub ? <p className="text-sm text-muted">{sub}</p> : null}
    </div>
  );
}

const SEV_CLASS: Record<string, string> = { high: "sev-high text-danger", medium: "sev-medium text-warning", low: "sev-low text-ink" };

export function SeverityPill({ severity }: { severity: string }) {
  return <span className={`aiva-chip ${SEV_CLASS[severity] || "sev-low"}`}>{severity.toUpperCase()}</span>;
}

export function RiskPill({ risk }: { risk: string }) {
  const map: Record<string, string> = {
    green: "border-success/50 text-success",
    amber: "border-warning/50 text-warning",
    red: "border-danger/50 text-danger",
  };
  return <span className={`aiva-chip ${map[risk] || "sev-low"}`}>{risk.toUpperCase()}</span>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="aiva-skeleton h-14" />
      ))}
    </div>
  );
}

/** Tiny data hook for the read-only APIs. */
export function useApi<T>(url: string): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok || !j.ok) setState({ data: null, error: j.error || `HTTP ${r.status}`, loading: false });
        else setState({ data: j as T, error: null, loading: false });
      })
      .catch((e) => alive && setState({ data: null, error: String(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
