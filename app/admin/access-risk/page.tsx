"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, useAdminData, LoadingBlock, TableShell } from "@/components/admin/ui";
import AtRiskTabs from "@/components/admin/people/AtRiskTabs";
import { useToast } from "@/components/ui/Toast";
import AccessReminderButton from "@/components/admin/sms/AccessReminderButton";
import BulkAccessReminder from "@/components/admin/sms/BulkAccessReminder";
import { ACCESS_AUTO_CAP_PER_INSTALLMENT } from "@/lib/sms/accessReminderConstants";

interface RiskRow {
  enrollmentId: string;
  studentId: string | null;
  phone: string;
  student: string;
  email: string | null;
  courseId: string;
  courseTitle: string;
  batchLabel: string | null;
  planType: string;
  amountDue: number;
  daysOverdue: number;
  installmentNo: number | null;
  access: { allowed: boolean; status: string; reason: string; daysLeft?: number | null };
  autoUsed: number;
  needsCall: boolean;
  lastRemindedAt: string | null;
}

interface AutomationState {
  settings: {
    killSwitch: boolean;
    dryRun: boolean;
    enabled: boolean;
    rampLimit: number;
    dailyCeiling: number;
  };
  needsCall: { course_enrollment_id: string; installment_no: number; auto_sequences_used: number; student_id: string | null }[];
  plan: {
    wouldSend: number;
    excluded: { reason: string; count: number }[];
    seatBookingOnly: number;
    inQuietHours: boolean;
    haltedReason: string | null;
    dryRun: boolean;
  };
}

const STATUS_PILL: Record<string, string> = { blocked: "pill-red", grace: "pill-amber", expiring: "pill-amber" };

export default function AccessRiskAdmin() {
  const { data: rows, loading, reload } = useAdminData<RiskRow[]>("/api/admin/access-risk", "rows");
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState<AutomationState | null>(null);

  const loadAuto = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sms/access-reminder/automation");
      const json = await res.json();
      if (res.ok && json.ok) setAuto(json as AutomationState);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadAuto(); }, [loadAuto]);

  const list = useMemo(() => {
    const all = rows || [];
    if (filter === "needs_call") return all.filter((r) => r.needsCall);
    if (!filter) return all;
    return all.filter((r) => r.access.status === filter || (!r.access.allowed && filter === "blocked"));
  }, [rows, filter]);

  const blocked = (rows || []).filter((r) => !r.access.allowed).length;
  const grace = (rows || []).filter((r) => r.access.status === "grace").length;
  const expiring = (rows || []).filter((r) => r.access.status === "expiring").length;
  const needsCallCount = (rows || []).filter((r) => r.needsCall).length || auto?.needsCall.length || 0;
  const totalDue = (rows || []).reduce((s, r) => s + (r.amountDue || 0), 0);

  const visibleIds = useMemo(() => new Set(list.map((r) => r.enrollmentId)), [list]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    const allSelected = list.length > 0 && list.every((r) => selected.has(r.enrollmentId));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) list.forEach((r) => next.delete(r.enrollmentId));
      else list.forEach((r) => next.add(r.enrollmentId));
      return next;
    });
  }

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

  const s = auto?.settings;

  return (
    <div>
      <PageHeader title="Access at Risk" subtitle="Access lens — learners whose lecture access is blocked or expiring. For chasing overdue fees, use Payment Risk." />
      <AtRiskTabs active="access" />

      {/* Automation status — ship defaults: dry-run ON, enabled OFF */}
      <div className="mb-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Access reminder automation</p>
            <p className="mt-0.5 text-xs text-muted">
              {s
                ? `${s.enabled ? "Enabled" : "Disabled"} · ${s.dryRun ? "dry-run ON (no real sends)" : "live"} · kill switch ${s.killSwitch ? "ON" : "OFF"} · ramp ${s.rampLimit} · ceiling ${s.dailyCeiling}`
                : "Loading settings…"}
              {auto?.plan?.inQuietHours ? " · quiet hours (IST)" : ""}
              {auto?.plan ? ` · next plan would send ${auto.plan.wouldSend}` : ""}
            </p>
          </div>
          {needsCallCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter("needs_call")}
              className="pill pill-red text-xs font-semibold"
            >
              Call these students · {needsCallCount}
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Blocked" value={blocked} tone="text-danger" />
        <Stat label="In grace" value={grace} tone="text-amber-600" />
        <Stat label="Expiring ≤7d" value={expiring} tone="text-amber-600" />
        <Stat label="Needs call" value={needsCallCount} tone="text-danger" />
        <Stat label="Pending dues" value={`₹${totalDue.toLocaleString("en-IN")}`} tone="text-primary" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {["", "blocked", "grace", "expiring", "needs_call"].map((f) => (
          <button key={f || "all"} onClick={() => setFilter(f)} className={`pill ${filter === f ? "pill-blue" : "pill-gray"}`}>
            {f === "" ? "All" : f === "needs_call" ? `Needs call (${needsCallCount})` : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <TableShell headers={["", "Student", "Course / Batch", "Inst.", "₹ Due", "Status", "Auto", "Actions"]}>
        <tr className="border-b border-line bg-surface2/40">
          <td className="px-3 py-2">
            <input
              type="checkbox"
              checked={list.length > 0 && list.every((r) => selected.has(r.enrollmentId))}
              onChange={toggleAllVisible}
              className="h-3.5 w-3.5 accent-[color:var(--primary)]"
              aria-label="Select all visible"
            />
          </td>
          <td colSpan={7} className="px-4 py-2 text-xs text-muted">
            {selected.size} selected
          </td>
        </tr>
        {list.map((r) => (
          <tr key={r.enrollmentId} className={`border-b border-line last:border-0 hover:bg-surface2 ${selected.has(r.enrollmentId) ? "bg-primary/5" : ""}`}>
            <td className="px-3 py-3">
              <input
                type="checkbox"
                checked={selected.has(r.enrollmentId)}
                onChange={() => toggleRow(r.enrollmentId)}
                className="h-3.5 w-3.5 accent-[color:var(--primary)]"
                aria-label={`Select ${r.student}`}
              />
            </td>
            <td className="px-4 py-3">
              <div className="font-medium">{r.student}</div>
              <div className="text-xs text-muted">{r.phone}</div>
            </td>
            <td className="px-4 py-3">
              <div>{r.courseTitle}</div>
              {r.batchLabel ? <div className="text-xs text-muted">{r.batchLabel}</div> : null}
            </td>
            <td className="px-4 py-3 tabular-nums text-xs">
              {r.installmentNo != null ? `#${r.installmentNo}` : "—"}
            </td>
            <td className="px-4 py-3 font-semibold">₹{(r.amountDue || 0).toLocaleString("en-IN")}</td>
            <td className="px-4 py-3">
              <span className={`pill ${STATUS_PILL[r.access.status] || (!r.access.allowed ? "pill-red" : "pill-gray")} text-[10px]`}>
                {!r.access.allowed ? "blocked" : r.access.status}
              </span>
              {r.access.status === "grace" && r.access.daysLeft != null && (
                <div className="mt-0.5 text-[10px] text-muted">{r.access.daysLeft}d left</div>
              )}
              {r.daysOverdue > 0 && !r.access.allowed && (
                <div className="mt-0.5 text-[10px] text-muted">{r.daysOverdue}d overdue</div>
              )}
            </td>
            <td className="px-4 py-3 text-xs tabular-nums">
              <span className={r.needsCall ? "font-semibold text-danger" : "text-ink2"}>
                {r.autoUsed}/{ACCESS_AUTO_CAP_PER_INSTALLMENT}
              </span>
              {r.needsCall && <div className="text-[10px] text-danger">needs call</div>}
              {r.lastRemindedAt && (
                <div className="text-[10px] text-muted" title={r.lastRemindedAt}>
                  last {new Date(r.lastRemindedAt).toLocaleDateString("en-IN")}
                </div>
              )}
            </td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                <AccessReminderButton enrollmentId={r.enrollmentId} />
                {r.studentId ? (
                  <Link
                    href={`/admin/students/${r.studentId}?enrollmentId=${r.enrollmentId}`}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    View
                  </Link>
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
                <button disabled={busy === r.enrollmentId} onClick={() => override(r, "grant", 1)} className="text-primary disabled:opacity-50">+1m</button>
                <button disabled={busy === r.enrollmentId} onClick={() => override(r, "revoke")} className="text-danger disabled:opacity-50">Revoke</button>
                <a href={`tel:${r.phone}`} className="text-ink2">Call</a>
              </div>
            </td>
          </tr>
        ))}
        {list.length === 0 && (
          <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">No learners at risk.</td></tr>
        )}
      </TableShell>

      <BulkAccessReminder
        selectedIds={[...selected].filter((id) => visibleIds.has(id))}
        onClear={() => setSelected(new Set())}
        onSent={() => { reload(); void loadAuto(); }}
      />
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
