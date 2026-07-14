"use client";

import { useMemo, useState } from "react";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import AtRiskTabs from "@/components/admin/people/AtRiskTabs";
import { useToast } from "@/components/ui/Toast";

interface RiskRow {
  enrollmentId: string;
  phone: string;
  student: string;
  email: string | null;
  courseId: string;
  courseTitle: string;
  batchLabel: string | null;
  planType: string;
  amountDue: number;
  daysOverdue: number;
  access: { allowed: boolean; status: string; reason: string; daysLeft?: number | null };
}

const STATUS_PILL: Record<string, string> = { blocked: "pill-red", grace: "pill-amber", expiring: "pill-amber" };

export default function AccessRiskAdmin() {
  const { data: rows, loading, reload } = useAdminData<RiskRow[]>("/api/admin/access-risk", "rows");
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo(() => {
    const all = rows || [];
    if (!filter) return all;
    return all.filter((r) => r.access.status === filter);
  }, [rows, filter]);

  const blocked = (rows || []).filter((r) => !r.access.allowed).length;
  const grace = (rows || []).filter((r) => r.access.status === "grace").length;
  const expiring = (rows || []).filter((r) => r.access.status === "expiring").length;
  const totalDue = (rows || []).reduce((s, r) => s + (r.amountDue || 0), 0);

  async function override(r: RiskRow, mode: "grant" | "revoke", months?: number) {
    setBusy(r.enrollmentId);
    const expires_at = mode === "grant" && months ? new Date(Date.now() + months * 30 * 86400000).toISOString() : null;
    const res = await fetch("/api/admin/access-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: r.phone, course_id: r.courseId, mode, expires_at, note: "Set from Access at Risk" }),
    });
    setBusy(null);
    if (res.ok) { toast(mode === "revoke" ? "Access revoked" : "Access granted", "success"); reload(); }
    else toast("Could not update access", "error");
  }

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Access at Risk" subtitle="Access lens — learners whose lecture access is blocked or expiring. For chasing overdue fees, use Payment Risk." />
      <AtRiskTabs active="access" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Blocked" value={blocked} tone="text-danger" />
        <Stat label="In grace" value={grace} tone="text-amber-600" />
        <Stat label="Expiring ≤7d" value={expiring} tone="text-amber-600" />
        <Stat label="Pending dues" value={`₹${totalDue.toLocaleString("en-IN")}`} tone="text-primary" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {["", "blocked", "grace", "expiring"].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`pill ${filter === s ? "pill-blue" : "pill-gray"}`}>
            {s === "" ? "All" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <TableShell headers={["Student", "Course / Batch", "Plan", "₹ Due", "Overdue", "Status", "Actions"]}>
        {list.map((r) => (
          <tr key={r.enrollmentId} className="border-b border-line last:border-0 hover:bg-surface2">
            <td className="px-4 py-3">
              <div className="font-medium">{r.student}</div>
              <div className="text-xs text-muted">{r.phone}</div>
            </td>
            <td className="px-4 py-3">
              <div>{r.courseTitle}</div>
              {r.batchLabel && <div className="text-xs text-muted">{r.batchLabel}</div>}
            </td>
            <td className="px-4 py-3 text-xs uppercase">{r.planType}</td>
            <td className="px-4 py-3 font-semibold">₹{(r.amountDue || 0).toLocaleString("en-IN")}</td>
            <td className="px-4 py-3">{r.daysOverdue > 0 ? `${r.daysOverdue}d` : r.access.daysLeft != null ? `${r.access.daysLeft}d left` : "—"}</td>
            <td className="px-4 py-3">
              <span className={`pill ${STATUS_PILL[r.access.status] || "pill-gray"} text-[10px]`}>
                {r.access.allowed ? r.access.status : "blocked"}
              </span>
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <button disabled={busy === r.enrollmentId} onClick={() => override(r, "grant", 1)} className="text-primary disabled:opacity-50">+1 month</button>
                <button disabled={busy === r.enrollmentId} onClick={() => override(r, "grant")} className="text-success disabled:opacity-50">Lifetime</button>
                <button disabled={busy === r.enrollmentId} onClick={() => override(r, "revoke")} className="text-danger disabled:opacity-50">Revoke</button>
                <a href={`tel:${r.phone}`} className="text-ink2">Call</a>
              </div>
            </td>
          </tr>
        ))}
        {list.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">No learners at risk. 🎉</td></tr>
        )}
      </TableShell>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}
