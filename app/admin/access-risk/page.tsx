"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, LoadingBlock } from "@/components/admin/ui";
import AtRiskTabs from "@/components/admin/people/AtRiskTabs";
import StudentNameLink from "@/components/admin/StudentNameLink";
import { useToast } from "@/components/ui/Toast";
import AccessReminderButton from "@/components/admin/sms/AccessReminderButton";
import BulkAccessReminder from "@/components/admin/sms/BulkAccessReminder";
import { useSelectableRows } from "@/lib/hooks/useSelectableRows";
import { ACCESS_AUTO_CAP_PER_INSTALLMENT } from "@/lib/sms/accessReminderConstants";
import { ACCESS_GRANT_MAX_DAYS_DEFAULT } from "@/lib/accessOverridePolicy";
import { formatINR } from "@/lib/dates";

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
  amountPaid: number;
  totalFee: number;
  daysOverdue: number;
  installmentNo: number | null;
  progressLabel: string;
  access: { allowed: boolean; status: string; reason: string; daysLeft?: number | null };
  scheduleAccess: { status: string; reason: string; graceEndsAt?: string | null; daysLeft?: number | null };
  riskKind?: string | null;
  grant: { expiresAt: string | null; note: string | null; createdBy: string | null; daysLeft: number | null } | null;
  autoUsed: number;
  needsCall: boolean;
  needsCallReason: string | null;
  lastRemindedAt: string | null;
  paymentFailures: number;
  verifyingStuck: number;
  remindEnabled?: boolean;
  inactionReason?: string | null;
}

interface AccessRiskPayload {
  rows: RiskRow[];
  grants: {
    student: string; phone: string; courseTitle: string; expiresAt: string | null;
    createdBy: string | null; reason: string | null; amountDue: number; scheduleStatus: string;
  }[];
  paymentFailureTotals: {
    failedStudents: number; verifyingStuckStudents: number; failedRows: number; verifyingStuckRows: number;
  };
  indefiniteOverrides: number;
  automation?: {
    killSwitch: boolean;
    enabled: boolean;
    dryRun: boolean;
    rampLimit: number;
    dailyCeiling: number;
    quietHours: boolean;
  };
}

const STATUS_PILL: Record<string, string> = { blocked: "pill-red", grace: "pill-amber", expiring: "pill-amber" };

export default function AccessRiskAdmin() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [grantReason, setGrantReason] = useState("");
  const [grantTarget, setGrantTarget] = useState<RiskRow | null>(null);
  const [full, setFull] = useState<AccessRiskPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/access-risk");
      const json = await res.json();
      if (res.ok && json.ok) setFull(json as AccessRiskPayload);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const listSource = full?.rows || [];
  const reload = load;

  const list = useMemo(() => {
    if (filter === "needs_call") return listSource.filter((r) => r.needsCall);
    if (filter === "grants") return listSource.filter((r) => !!r.grant);
    if (filter === "not_actionable") return listSource.filter((r) => !r.remindEnabled);
    if (filter === "blocked") return listSource.filter((r) => r.scheduleAccess?.status === "blocked");
    if (filter === "grace") return listSource.filter((r) => r.scheduleAccess?.status === "grace");
    if (filter === "payment_fail") return listSource.filter((r) => r.paymentFailures >= 2 || r.verifyingStuck > 0);
    return listSource;
  }, [listSource, filter]);

  const blocked = listSource.filter((r) => r.scheduleAccess?.status === "blocked").length;
  const grace = listSource.filter((r) => r.scheduleAccess?.status === "grace").length;
  const needsCallCount = listSource.filter((r) => r.needsCall).length;
  const grantCount = listSource.filter((r) => r.grant).length;
  const notActionable = listSource.filter((r) => !r.remindEnabled).length;
  const totalDue = listSource.reduce((s, r) => s + (r.amountDue || 0), 0);

  // Select-all / selection only covers actionable rows in the current filter.
  const selectableIds = useMemo(
    () => list.filter((r) => r.remindEnabled).map((r) => r.enrollmentId),
    [list],
  );
  const {
    selectedVisibleIds,
    toggleRow,
    toggleAllVisible,
    clear,
    allSelected,
    someSelected,
    selected,
  } = useSelectableRows(selectableIds);

  async function revokeGrant(r: RiskRow) {
    setBusy(r.enrollmentId);
    const res = await fetch("/api/admin/access-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: r.phone, course_id: r.courseId, mode: "revoke", reason: "Revoked from Access at Risk" }),
    });
    setBusy(null);
    if (res.ok) { toast("Grant revoked — schedule state restored", "success"); reload(); void load(); }
    else toast("Could not revoke grant", "error");
  }

  async function submitGrant() {
    if (!grantTarget) return;
    const reason = grantReason.trim();
    if (!reason) { toast("Reason is required", "error"); return; }
    setBusy(grantTarget.enrollmentId);
    const expires_at = new Date(Date.now() + ACCESS_GRANT_MAX_DAYS_DEFAULT * 86400000).toISOString();
    const res = await fetch("/api/admin/access-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: grantTarget.phone,
        course_id: grantTarget.courseId,
        mode: "grant",
        expires_at,
        note: reason,
      }),
    });
    setBusy(null);
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      toast(`Access granted for ${ACCESS_GRANT_MAX_DAYS_DEFAULT} days`, "success");
      setGrantTarget(null);
      setGrantReason("");
      reload();
      void load();
    } else toast(json.error || "Could not grant access", "error");
  }

  if (loading && !listSource.length) return <LoadingBlock />;

  const failTotals = full?.paymentFailureTotals;

  return (
    <div>
      <PageHeader title="Access at Risk" subtitle="Schedule lens — blocked/grace students stay visible even when a temporary grant is holding access open." />
      <AtRiskTabs active="access" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Schedule blocked" value={blocked} tone="text-danger" />
        <Stat label="In grace" value={grace} tone="text-amber-600" />
        <Stat label="Access granted" value={grantCount} tone="text-primary" />
        <Stat label="Needs call" value={needsCallCount} tone="text-danger" />
        <Stat label="Pending dues" value={`₹${totalDue.toLocaleString("en-IN")}`} tone="text-primary" />
      </div>

      {(failTotals || full?.indefiniteOverrides) ? (
        <div className="mb-4 rounded-2xl border border-line bg-surface p-3 text-xs text-ink2">
          Payment failures (14d): <strong>{failTotals?.failedStudents ?? 0}</strong> students ·
          Stuck VERIFYING (&gt;24h): <strong>{failTotals?.verifyingStuckStudents ?? 0}</strong> ·
          Indefinite overrides in DB: <strong>{full?.indefiniteOverrides ?? 0}</strong>
        </div>
      ) : null}

      {grantCount > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="text-sm font-semibold text-ink">Access granted (leakage report)</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 pr-3">Student</th>
                  <th className="py-1 pr-3">Course</th>
                  <th className="py-1 pr-3">Until</th>
                  <th className="py-1 pr-3">By</th>
                  <th className="py-1 pr-3">Outstanding</th>
                  <th className="py-1">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(full?.grants || []).map((g) => (
                  <tr key={`${g.phone}-${g.courseTitle}`} className="border-t border-line/60">
                    <td className="py-1.5 pr-3 font-medium">{g.student}</td>
                    <td className="py-1.5 pr-3">{g.courseTitle}</td>
                    <td className="py-1.5 pr-3">{g.expiresAt ? g.expiresAt.slice(0, 10) : "—"}</td>
                    <td className="py-1.5 pr-3">{g.createdBy || "—"}</td>
                    <td className="py-1.5 pr-3">{formatINR(g.amountDue)}</td>
                    <td className="py-1.5">{g.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {(["", "blocked", "grace", "grants", "needs_call", "not_actionable"] as const).map((f) => (
          <button key={f || "all"} onClick={() => setFilter(f)} className={`pill ${filter === f ? "pill-blue" : "pill-gray"}`}>
            {f === "" ? "All"
              : f === "needs_call" ? `Needs call (${needsCallCount})`
                : f === "grants" ? `Access granted (${grantCount})`
                  : f === "not_actionable" ? `Not actionable (${notActionable})`
                    : f === "blocked" ? `Blocked (${blocked})`
                      : f === "grace" ? `In grace (${grace})`
                        : f}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="w-9 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAllVisible}
                  disabled={selectableIds.length === 0}
                  className="h-3.5 w-3.5 accent-[color:var(--primary)] disabled:opacity-40"
                  title={selectableIds.length === 0
                    ? "No actionable students in this filter"
                    : "Select all actionable students matching the current filters"}
                  aria-label="Select all actionable students matching the current filters"
                />
              </th>
              {["Student", "Course", "Progress", "₹ Due", "Schedule", "Grant", "Auto", "Actions"].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const selectable = !!r.remindEnabled;
              return (
                <tr key={r.enrollmentId} className={`border-b border-line last:border-0 hover:bg-surface2 ${selected.has(r.enrollmentId) ? "bg-primary/5" : ""}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.enrollmentId)}
                      onChange={() => toggleRow(r.enrollmentId)}
                      onClick={(ev) => ev.stopPropagation()}
                      disabled={!selectable}
                      className="h-3.5 w-3.5 accent-[color:var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={selectable ? `Select ${r.student}` : `${r.student}: ${r.inactionReason || "Not actionable"}`}
                      title={selectable ? `Select ${r.student}` : (r.inactionReason || "Not actionable — cannot bulk-remind")}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <StudentNameLink studentId={r.studentId} enrollmentId={r.enrollmentId} name={r.student} />
                    <div className="text-xs text-muted">{r.phone}</div>
                    {r.inactionReason && !r.remindEnabled && (
                      <div className="mt-0.5 text-[10px] font-semibold text-amber-800" title={r.inactionReason}>{r.inactionReason}</div>
                    )}
                    {r.paymentFailures >= 2 && <div className="text-[10px] font-semibold text-danger">{r.paymentFailures} failed attempts</div>}
                    {r.verifyingStuck > 0 && <div className="text-[10px] font-semibold text-amber-700">VERIFYING stuck</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div>{r.courseTitle}</div>
                    {r.batchLabel ? <div className="text-xs text-muted">{r.batchLabel}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div>{r.progressLabel}</div>
                    <div className="text-muted">{formatINR(r.amountPaid)} / {formatINR(r.totalFee)}</div>
                  </td>
                  <td className="px-4 py-3 font-semibold">{formatINR(r.amountDue)}</td>
                  <td className="px-4 py-3">
                    <span className={`pill ${STATUS_PILL[r.scheduleAccess?.status] || "pill-gray"} text-[10px]`}>
                      {r.scheduleAccess?.status || "—"}
                    </span>
                    {r.scheduleAccess?.status === "grace" && r.scheduleAccess.daysLeft != null && (
                      <div className="mt-0.5 text-[10px] text-muted">{r.scheduleAccess.daysLeft}d left</div>
                    )}
                    {r.daysOverdue > 0 && r.scheduleAccess?.status === "blocked" && (
                      <div className="mt-0.5 text-[10px] text-muted">{r.daysOverdue}d overdue</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.grant ? (
                      <>
                        <span className="pill pill-blue text-[10px]">until {r.grant.expiresAt?.slice(0, 10)}</span>
                        <div className="mt-0.5 text-[10px] text-muted">{r.grant.createdBy || "staff"}{r.grant.note ? ` · ${r.grant.note}` : ""}</div>
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    <span className={r.needsCall ? "font-semibold text-danger" : "text-ink2"}>
                      {r.autoUsed}/{ACCESS_AUTO_CAP_PER_INSTALLMENT}
                    </span>
                    {r.needsCall && <div className="text-[10px] text-danger">{r.needsCallReason || "needs call"}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                      <AccessReminderButton
                        enrollmentId={r.enrollmentId}
                        // needs_call: bulk unselectable, but single Remind stays available (e.g. Aman).
                        disabledReason={
                          !r.remindEnabled && !r.needsCall
                            ? (r.inactionReason || "Not actionable")
                            : null
                        }
                      />
                      {r.studentId ? (
                        <Link href={`/admin/students/${r.studentId}?enrollmentId=${r.enrollmentId}`} className="text-xs font-semibold text-primary hover:underline">View</Link>
                      ) : <span className="text-xs text-muted">—</span>}
                      {r.grant ? (
                        <button disabled={busy === r.enrollmentId} onClick={() => revokeGrant(r)} className="text-danger disabled:opacity-50">Revoke grant</button>
                      ) : (
                        <button disabled={busy === r.enrollmentId} onClick={() => { setGrantTarget(r); setGrantReason(""); }} className="text-primary disabled:opacity-50">+{ACCESS_GRANT_MAX_DAYS_DEFAULT}d</button>
                      )}
                      <a href={`tel:${r.phone}`} className="text-ink2">Call</a>
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted">No learners at risk.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <BulkAccessReminder
        selectedIds={selectedVisibleIds}
        onClear={clear}
        onSent={() => { reload(); void load(); }}
        killSwitch={!!full?.automation?.killSwitch}
        quietHours={!!full?.automation?.quietHours}
      />

      {grantTarget && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4" onClick={() => setGrantTarget(null)}>
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-base font-bold">Grant access · {ACCESS_GRANT_MAX_DAYS_DEFAULT} days</h3>
            <p className="mt-1 text-sm text-ink2">{grantTarget.student} · does not change fees or due dates.</p>
            <label className="mt-3 block text-xs font-semibold text-muted">Reason (required)</label>
            <textarea
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-surface2 p-2 text-sm"
              rows={3}
              placeholder="Why is temporary access needed?"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setGrantTarget(null)} className="btn btn-secondary text-sm">Cancel</button>
              <button onClick={submitGrant} disabled={!grantReason.trim() || busy === grantTarget.enrollmentId} className="btn btn-primary text-sm">
                Grant {ACCESS_GRANT_MAX_DAYS_DEFAULT} days
              </button>
            </div>
          </div>
        </div>
      )}
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
