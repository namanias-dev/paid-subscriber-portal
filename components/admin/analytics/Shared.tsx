"use client";

import InfoTip from "@/components/admin/InfoTip";
import type { MetricDef } from "@/lib/analytics/metrics";

export const nf = (n: number) => n.toLocaleString("en-IN");
export const pctStr = (v: number | null | undefined) => (v === null || v === undefined ? "N/A" : `${v}%`);

export function Stat({ def, label, value, hint, tone }: { def?: MetricDef; label?: string; value: string; hint?: string; tone?: "green" | "amber" | "red" }) {
  const title = def?.label || label || "";
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1 text-muted">
        <span className="text-xs font-medium">{title}</span>
        {def && <InfoTip label={def.label} meaning={def.meaning} formula={def.formula} />}
      </div>
      <p className={`mt-1.5 font-heading text-xl font-extrabold ${tone === "green" ? "text-success" : tone === "amber" ? "text-warning" : tone === "red" ? "text-danger" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
