"use client";

import { formatINR, formatISTDate } from "@/lib/dates";
import { installmentStatus } from "@/lib/installments";
import type { InstallmentItem } from "@/lib/types";

/**
 * Shared, read-only presentational helpers for the finance "collections" views
 * (Course EMI drill-in + At Risk worklist). No data mutation anywhere — these
 * only render figures already derived from the ONE source (deriveCollections).
 */

export type LineStatus = ReturnType<typeof installmentStatus>;

export const LINE_META: Record<LineStatus, { label: string; pill: string; dot: string }> = {
  paid: { label: "Paid", pill: "pill-green", dot: "var(--success)" },
  overdue: { label: "Overdue", pill: "pill-red", dot: "var(--danger)" },
  "due-soon": { label: "Due soon", pill: "pill-amber", dot: "var(--warning)" },
  upcoming: { label: "Upcoming", pill: "pill-gray", dot: "var(--muted)" },
  waived: { label: "Waived", pill: "pill-gray", dot: "var(--muted)" },
  cancelled: { label: "Cancelled", pill: "pill-gray", dot: "var(--muted)" },
};

export function LinePill({ status }: { status: LineStatus }) {
  const m = LINE_META[status];
  return <span className={`pill ${m.pill} text-[10px]`}>{m.label}</span>;
}

/** Full installment schedule for one enrollment — colour-coded, accessible. */
export function InstallmentSchedule({ schedule, now = Date.now() }: { schedule: InstallmentItem[]; now?: number }) {
  const lines = (schedule || []).filter((s) => s.kind !== "seat" || (s.amount || 0) > 0 || s.paid);
  if (lines.length === 0) {
    return <p className="px-1 py-2 text-xs text-muted">No installment schedule on this enrollment.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Line</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
            <th className="px-3 py-2 font-semibold">Due</th>
            <th className="px-3 py-2 font-semibold">Paid on</th>
            <th className="px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((s, i) => {
            const st = installmentStatus(s, now);
            const cancelled = st === "cancelled" || st === "waived";
            return (
              <tr key={`${s.no}-${i}`} className="border-b border-line last:border-0">
                <td className="px-3 py-2 tabular-nums text-muted">{s.no === 0 ? "—" : s.no}</td>
                <td className={`px-3 py-2 ${cancelled ? "text-muted line-through" : "text-ink"}`}>{s.label}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(s.amount || 0)}</td>
                <td className="px-3 py-2 tabular-nums text-ink2">{s.due ? formatISTDate(s.due) : "—"}</td>
                <td className="px-3 py-2 tabular-nums text-ink2">{s.paid && s.paid_at ? formatISTDate(s.paid_at) : "—"}</td>
                <td className="px-3 py-2"><LinePill status={st} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Small labelled figure used in drill-in headers. */
export function HeaderStat({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "danger" | "success" | "warning";
  /** Native tooltip explaining the metric's scope. */
  title?: string;
}) {
  const color =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4" title={title}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-heading text-xl font-extrabold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
