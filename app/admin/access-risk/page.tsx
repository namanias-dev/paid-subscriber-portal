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
import AccessRiskSummary from "@/components/admin/access/AccessRiskSummary";
import InstallmentProofReviewPanel from "@/components/admin/access/InstallmentProofReviewPanel";

interface RiskRow {
  enrollmentId: string;
  studentId: string | null;
  phone: string;
  student: string;
  email: string | null;
  loginCode?: string | null;
  courseId: string;
  courseTitle: string;
  batchLabel: string | null;
  planType: string;
  amountDue: number;
  amountPaid: number;
  totalFee: number;
  pctPaid?: number;
  daysOverdue: number;
  dueDate?: string | null;
  installmentNo: number | null;
  progressLabel: string;
  access: { allowed: boolean; status: string; reason: string; daysLeft?: number | null };
  scheduleAccess: { status: string; reason: string; graceEndsAt?: string | null; daysLeft?: number | null };
  riskKind?: string | null;
  grant: { expiresAt: string | null; note: string | null; createdBy: string | null; daysLeft: number | null } | null;
  autoUsed: number;
  remindersSent?: number;
  ladderUsed?: number;
  ladderCap?: number;
  needsCall: boolean;
  needsCallReason: string | null;
  lastRemindedAt: string | null;
  lastContactAt?: string | null;
  callTaskStatus?: string | null;
  callTaskReason?: string | null;
  paymentFailures: number;
  verifyingStuck: number;
  remindEnabled?: boolean;
  inactionReason?: string | null;
  pendingProof?: {
    id: string;
    filesCount: number;
    submittedAt: string;
    ageMinutes: number;
  } | null;
}

interface AccessRiskPayload {
  rows: RiskRow[];
  pendingProofCount?: number;
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
  listMeta?: {
    total: number;
    remindEnabled: number;
    notActionable: number;
    genuinelyBlocked?: number;
    genuinelyGrace?: number;
    moneyOverdueAligned?: number;
    note?: string;
  };
  summary?: {
    blockedCount: number;
    graceCount: number;
    activeExtensions: number;
    outstandingByTier: Record<string, number>;
    remindersSentToday: number;
    totalOutstanding: number;
  };
}

type SortKey = "days_overdue" | "pct_paid" | "amount_due" | "course" | "name" | "contacted" | "oldest_pending";

const STATUS_PILL: Record<string, string> = { blocked: "pill-red", grace: "pill-amber", expiring: "pill-amber" };

function pctTone(pct: number): string {
  if (pct < 25) return "text-danger font-semibold";
  if (pct < 50) return "text-amber-700 font-semibold";
  if (pct < 75) return "text-ink2";
  return "text-emerald-700";
}

function proofAgeLabel(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function AccessRiskAdmin() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("days_overdue");
  const [sortAsc, setSortAsc] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [grantReason, setGrantReason] = useState("");
  const [grantTarget, setGrantTarget] = useState<RiskRow | null>(null);
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<{ created_at: string; event_type: string; actor: string | null; reason: string | null }[]>([]);
  const [reviewTarget, setReviewTarget] = useState<RiskRow | null>(null);
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

  const courses = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of listSource) m.set(r.courseId, r.courseTitle);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [listSource]);

  const list = useMemo(() => {
    let rows = listSource;
    if (filter === "needs_call") rows = rows.filter((r) => r.needsCall || r.callTaskStatus);
    else if (filter === "grants") rows = rows.filter((r) => !!r.grant);
    else if (filter === "not_actionable") rows = rows.filter((r) => !r.remindEnabled);
    else if (filter === "blocked") rows = rows.filter((r) => r.scheduleAccess?.status === "blocked");
    else if (filter === "grace") rows = rows.filter((r) => r.scheduleAccess?.status === "grace");
    else if (filter === "payment_fail") rows = rows.filter((r) => r.paymentFailures >= 2 || r.verifyingStuck > 0);
    else if (filter === "uncontacted") rows = rows.filter((r) => !r.lastContactAt && !r.lastRemindedAt);
    else if (filter === "contacted") rows = rows.filter((r) => !!(r.lastContactAt || r.lastRemindedAt));
    else if (filter === "proof_uploaded") rows = rows.filter((r) => !!r.pendingProof);
    if (courseFilter) rows = rows.filter((r) => r.courseId === courseFilter);

    const mul = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "pct_paid": return mul * ((a.pctPaid ?? 0) - (b.pctPaid ?? 0));
        case "amount_due": return mul * (a.amountDue - b.amountDue);
        case "course": return mul * a.courseTitle.localeCompare(b.courseTitle);
        case "name": return mul * a.student.localeCompare(b.student);
        case "contacted": {
          const ac = a.lastContactAt || a.lastRemindedAt || "";
          const bc = b.lastContactAt || b.lastRemindedAt || "";
          return mul * ac.localeCompare(bc);
        }
        case "oldest_pending": {
          const ap = a.pendingProof?.submittedAt || "";
          const bp = b.pendingProof?.submittedAt || "";
          if (!ap && !bp) return 0;
          if (!ap) return 1;
          if (!bp) return -1;
          return ap.localeCompare(bp);
        }
        default: return mul * (a.daysOverdue - b.daysOverdue);
      }
    });
  }, [listSource, filter, courseFilter, sortKey, sortAsc]);

  const blocked = listSource.filter((r) => r.scheduleAccess?.status === "blocked").length;
  const grace = listSource.filter((r) => r.scheduleAccess?.status === "grace").length;
  const needsCallCount = listSource.filter((r) => r.needsCall || r.callTaskStatus).length;
  const grantCount = listSource.filter((r) => !!r.grant).length;
  const notActionable = listSource.filter((r) => !r.remindEnabled).length;
  const uncontacted = listSource.filter((r) => !r.lastContactAt && !r.lastRemindedAt).length;
  const pendingProofCount = full?.pendingProofCount ?? listSource.filter((r) => r.pendingProof).length;
  const totalDue = listSource.reduce((s, r) => s + (r.amountDue || 0), 0);

  // Every filtered row is selectable (grey-row fix — remindEnabled no longer gates checkboxes).
  const selectableIds = useMemo(() => list.map((r) => r.enrollmentId), [list]);
  const {
    selectedVisibleIds,
    toggleRow,
    toggleAllVisible,
    clear,
    allSelected,
    someSelected,
    selected,
  } = useSelectableRows(selectableIds);

  const selectedRows = useMemo(
    () => list.filter((r) => selected.has(r.enrollmentId)),
    [list, selected],
  );

  async function accessAction(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/access-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  }

  async function revokeGrant(r: RiskRow) {
    setBusy(r.enrollmentId);
    const { ok } = await accessAction({
      action: "revoke_extension",
      phone: r.phone,
      course_id: r.courseId,
      enrollment_id: r.enrollmentId,
      reason: "Revoked from Access at Risk",
    });
    setBusy(null);
    if (ok) { toast("Grant revoked — schedule state restored", "success"); reload(); }
    else toast("Could not revoke grant", "error");
  }

  async function submitGrant() {
    if (!grantTarget) return;
    const reason = grantReason.trim();
    if (!reason) { toast("Reason is required", "error"); return; }
    setBusy(grantTarget.enrollmentId);
    const { ok, json } = await accessAction({
      action: "extend",
      phone: grantTarget.phone,
      course_id: grantTarget.courseId,
      enrollment_id: grantTarget.enrollmentId,
      days: ACCESS_GRANT_MAX_DAYS_DEFAULT,
      reason,
    });
    setBusy(null);
    if (ok) {
      toast(`Access granted for ${ACCESS_GRANT_MAX_DAYS_DEFAULT} days`, "success");
      setGrantTarget(null);
      setGrantReason("");
      reload();
    } else toast(json.error || "Could not grant access", "error");
  }

  async function bulkExtend() {
    const reason = window.prompt(`Extend ${selectedRows.length} students by ${ACCESS_GRANT_MAX_DAYS_DEFAULT} days — reason (required):`);
    if (!reason?.trim()) return;
    setBusy("bulk");
    let okN = 0;
    for (const r of selectedRows) {
      const { ok } = await accessAction({
        action: "extend",
        phone: r.phone,
        course_id: r.courseId,
        enrollment_id: r.enrollmentId,
        days: ACCESS_GRANT_MAX_DAYS_DEFAULT,
        reason: reason.trim(),
      });
      if (ok) okN++;
    }
    setBusy(null);
    toast(`Extended ${okN}/${selectedRows.length}`, okN ? "success" : "error");
    clear();
    reload();
  }

  async function bulkCallTasks() {
    setBusy("bulk");
    let okN = 0;
    for (const r of selectedRows) {
      const { ok } = await accessAction({
        action: "create_call_task",
        enrollment_id: r.enrollmentId,
        installment_no: r.installmentNo,
        amount_due: r.amountDue,
        days_overdue: r.daysOverdue,
        reason: "access_at_risk_bulk",
      });
      if (ok) okN++;
    }
    setBusy(null);
    toast(`Call tasks ${okN}/${selectedRows.length}`, okN ? "success" : "error");
    clear();
    reload();
  }

  async function openAudit(r: RiskRow) {
    setAuditFor(r.enrollmentId);
    setAuditEvents([]);
    try {
      if (!r.studentId) return;
      const res = await fetch(`/api/admin/students/${r.studentId}/history?enrollmentId=${r.enrollmentId}`);
      const json = await res.json();
      const events = (json.events || [])
        .slice(0, 30);
      setAuditEvents(events.map((e: {
        at?: string;
        type?: string;
        title?: string;
        detail?: string | null;
        reason?: string | null;
        actor?: { label?: string; id?: string } | string | null;
      }) => ({
        created_at: e.at || "",
        event_type: e.type || e.title || "",
        actor: typeof e.actor === "string" ? e.actor : (e.actor?.label || e.actor?.id || null),
        reason: e.detail || e.reason || e.title || null,
      })));
    } catch { /* non-fatal */ }
  }

  function exportCsv() {
    const headers = [
      "student", "login_code", "phone", "course", "batch", "pct_paid", "paid", "total", "amount_due",
      "installment_no", "due_date", "days_overdue", "lectures", "schedule", "reminders_sent",
      "last_contact", "extension_until", "extension_by", "extension_reason", "call_task",
    ];
    const lines = [headers.join(",")];
    for (const r of list) {
      lines.push([
        csvEscape(r.student),
        csvEscape(r.loginCode),
        csvEscape(r.phone),
        csvEscape(r.courseTitle),
        csvEscape(r.batchLabel),
        r.pctPaid ?? "",
        r.amountPaid,
        r.totalFee,
        r.amountDue,
        r.installmentNo ?? "",
        csvEscape(r.dueDate),
        r.daysOverdue,
        csvEscape(r.access?.allowed ? "open" : "locked"),
        csvEscape(r.scheduleAccess?.status),
        r.remindersSent ?? 0,
        csvEscape(r.lastContactAt || r.lastRemindedAt),
        csvEscape(r.grant?.expiresAt),
        csvEscape(r.grant?.createdBy),
        csvEscape(r.grant?.note),
        csvEscape(r.callTaskStatus),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `access-at-risk-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !listSource.length) return <LoadingBlock />;

  const failTotals = full?.paymentFailureTotals;

  return (
    <div>
      <PageHeader
        title="Access at Risk"
        subtitle="Lectures = live playback (grant wins). Schedule = money risk (ignores grant). Bulk actions use unified handlers."
        action={
          pendingProofCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
              {pendingProofCount} proof{pendingProofCount === 1 ? "" : "s"} awaiting review
            </span>
          ) : undefined
        }
      />
      {full?.summary && <AccessRiskSummary summary={full.summary} />}
      <AtRiskTabs active="access" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Schedule blocked" value={blocked} tone="text-danger" />
        <Stat label="In grace" value={grace} tone="text-amber-600" />
        <Stat label="Extensions" value={grantCount} tone="text-primary" />
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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([
          ["", "All"],
          ["blocked", `Blocked (${blocked})`],
          ["grace", `In grace (${grace})`],
          ["grants", `Extensions (${grantCount})`],
          ["needs_call", `Needs call (${needsCallCount})`],
          ["uncontacted", `Uncontacted (${uncontacted})`],
          ["contacted", "Contacted"],
          ["not_actionable", `Remind blocked (${notActionable})`],
          ["proof_uploaded", `Proof uploaded (${pendingProofCount})`],
        ] as const).map(([f, label]) => (
          <button key={f || "all"} onClick={() => setFilter(f)} className={`pill ${filter === f ? "pill-blue" : "pill-gray"}`}>
            {label}
          </button>
        ))}
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-1 text-xs"
          aria-label="Filter by course"
        >
          <option value="">All courses</option>
          {courses.map(([id, title]) => (
            <option key={id} value={id}>{title}</option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-full border border-line bg-surface px-3 py-1 text-xs"
          aria-label="Sort by"
        >
          <option value="days_overdue">Sort: days overdue</option>
          <option value="pct_paid">Sort: % paid</option>
          <option value="amount_due">Sort: ₹ due</option>
          <option value="course">Sort: course</option>
          <option value="name">Sort: name</option>
          <option value="contacted">Sort: last contact</option>
          <option value="oldest_pending">Sort: oldest pending proof</option>
        </select>
        <button onClick={() => setSortAsc((v) => !v)} className="pill pill-gray">{sortAsc ? "Asc" : "Desc"}</button>
        <button onClick={exportCsv} className="pill pill-gray">CSV export</button>
      </div>

      {selectedVisibleIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
          <span className="font-semibold">{selectedVisibleIds.length} selected</span>
          <span className="text-muted">Use Remind bar below · or</span>
          <button disabled={busy === "bulk"} onClick={() => void bulkExtend()} className="pill pill-blue">Bulk Extend</button>
          <button disabled={busy === "bulk"} onClick={() => void bulkCallTasks()} className="pill pill-red">Bulk Call task</button>
          <button onClick={clear} className="pill pill-gray">Clear</button>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1100px] text-left text-sm">
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
                  title="Select all matching the current filters"
                  aria-label="Select all matching the current filters"
                />
              </th>
              {["Student", "Course", "% / Paid", "₹ Due", "Instalment", "Schedule", "Lectures", "Reminders", "Contact", "Call", "Actions"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const pct = r.pctPaid ?? (r.totalFee > 0 ? Math.round((r.amountPaid / r.totalFee) * 100) : 0);
              const mismatch =
                (r.access?.allowed && r.scheduleAccess?.status === "blocked") ||
                (!r.access?.allowed && r.scheduleAccess?.status !== "blocked" && r.scheduleAccess?.status !== "grace");
              return (
                <tr key={r.enrollmentId} className={`border-b border-line last:border-0 hover:bg-surface2 ${selected.has(r.enrollmentId) ? "bg-primary/5" : ""}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.enrollmentId)}
                      onChange={() => toggleRow(r.enrollmentId)}
                      onClick={(ev) => ev.stopPropagation()}
                      className="h-3.5 w-3.5 accent-[color:var(--primary)]"
                      aria-label={`Select ${r.student}`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <StudentNameLink studentId={r.studentId} enrollmentId={r.enrollmentId} name={r.student} />
                    <div className="font-mono text-[10px] text-muted">{r.loginCode || "no code"}</div>
                    <div className="text-xs text-muted">{r.phone}</div>
                    {r.inactionReason && !r.remindEnabled && (
                      <div className="mt-0.5 text-[10px] font-semibold text-amber-800" title={r.inactionReason}>{r.inactionReason}</div>
                    )}
                    {r.pendingProof && (
                      <span className="mt-1 inline-flex pill pill-amber text-[10px]">
                        Proof · {r.pendingProof.filesCount} file{r.pendingProof.filesCount === 1 ? "" : "s"} · {proofAgeLabel(r.pendingProof.ageMinutes)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div>{r.courseTitle}</div>
                    {r.batchLabel ? <div className="text-xs text-muted">{r.batchLabel}</div> : null}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <div className={pctTone(pct)}>{pct}% paid</div>
                    <div className="text-muted">{formatINR(r.amountPaid)} / {formatINR(r.totalFee)}</div>
                  </td>
                  <td className="px-3 py-3 font-semibold">{formatINR(r.amountDue)}</td>
                  <td className="px-3 py-3 text-xs">
                    <div>#{r.installmentNo ?? "—"}</div>
                    <div className="text-muted">{r.dueDate || "—"}</div>
                    {r.daysOverdue > 0 && <div className="text-danger">{r.daysOverdue}d overdue</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`pill ${STATUS_PILL[r.scheduleAccess?.status] || "pill-gray"} text-[10px]`}>
                      {r.scheduleAccess?.status || "—"}
                    </span>
                    <div className="mt-0.5 text-[10px] text-muted">money risk</div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <span className={`pill ${r.access?.allowed ? "pill-green" : "pill-red"} text-[10px]`}>
                      {r.access?.allowed ? (r.access.status || "open") : "locked"}
                    </span>
                    <div className="mt-0.5 text-[10px] text-muted">playback</div>
                    {mismatch && (
                      <div className="mt-0.5 text-[10px] font-semibold text-amber-700">
                        mismatch: schedule {r.scheduleAccess?.status} · lectures {r.access?.allowed ? "open" : "locked"}
                      </div>
                    )}
                    {r.grant ? (
                      <>
                        <span className="mt-1 inline-block pill pill-blue text-[10px]">until {r.grant.expiresAt?.slice(0, 10)}</span>
                        <div className="mt-0.5 text-[10px] text-muted">{r.grant.createdBy || "staff"}{r.grant.note ? ` · ${r.grant.note}` : ""}</div>
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs tabular-nums">
                    <div>{r.remindersSent ?? 0} sent</div>
                    <div className="text-muted">{r.lastRemindedAt ? r.lastRemindedAt.slice(0, 10) : "—"}</div>
                    <div className="text-muted">auto {r.autoUsed}/{ACCESS_AUTO_CAP_PER_INSTALLMENT}</div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {(r.lastContactAt || r.lastRemindedAt)?.slice(0, 10) || "never"}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {r.callTaskStatus ? (
                      <span className="pill pill-red text-[10px]">{r.callTaskStatus}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                      <AccessReminderButton
                        enrollmentId={r.enrollmentId}
                        disabledReason={!r.remindEnabled ? (r.inactionReason || "Not sendable") : null}
                      />
                      {r.studentId ? (
                        <Link href={`/admin/students/${r.studentId}?enrollmentId=${r.enrollmentId}`} className="text-xs font-semibold text-primary hover:underline">View</Link>
                      ) : <span className="text-xs text-muted">—</span>}
                      {r.grant ? (
                        <button disabled={busy === r.enrollmentId} onClick={() => void revokeGrant(r)} className="text-danger disabled:opacity-50">Revoke</button>
                      ) : (
                        <button disabled={busy === r.enrollmentId} onClick={() => { setGrantTarget(r); setGrantReason(""); }} className="text-primary disabled:opacity-50">+{ACCESS_GRANT_MAX_DAYS_DEFAULT}d</button>
                      )}
                      <button type="button" onClick={() => void openAudit(r)} className="text-ink2">Audit</button>
                      {r.pendingProof && (
                        <button
                          type="button"
                          onClick={() => setReviewTarget(r)}
                          className="font-semibold text-amber-800 hover:underline"
                        >
                          Review proof
                        </button>
                      )}
                      <a href={`tel:${r.phone}`} className="text-ink2">Call</a>
                    </div>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-muted">No learners at risk.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <BulkAccessReminder
        selectedIds={selectedVisibleIds}
        onClear={clear}
        onSent={() => { reload(); }}
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
              <button onClick={() => void submitGrant()} disabled={!grantReason.trim() || busy === grantTarget.enrollmentId} className="btn btn-primary text-sm">
                Grant {ACCESS_GRANT_MAX_DAYS_DEFAULT} days
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewTarget?.pendingProof && (
        <InstallmentProofReviewPanel
          proofId={reviewTarget.pendingProof.id}
          student={reviewTarget.student}
          pctPaid={reviewTarget.pctPaid ?? (reviewTarget.totalFee > 0 ? Math.round((reviewTarget.amountPaid / reviewTarget.totalFee) * 100) : 0)}
          amountPaid={reviewTarget.amountPaid}
          totalFee={reviewTarget.totalFee}
          amountDue={reviewTarget.amountDue}
          onClose={() => setReviewTarget(null)}
          onUpdated={() => { setReviewTarget(null); reload(); }}
        />
      )}

      {auditFor && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4" onClick={() => setAuditFor(null)}>
          <div className="card max-h-[70vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-base font-bold">Access audit trail</h3>
            <ul className="mt-3 space-y-2 text-xs">
              {auditEvents.length === 0 && <li className="text-muted">No events (or student link missing).</li>}
              {auditEvents.map((e, i) => (
                <li key={`${e.created_at}-${i}`} className="border-b border-line/60 pb-2">
                  <div className="font-semibold">{e.event_type}</div>
                  <div className="text-muted">{e.created_at?.slice(0, 19)} · {e.actor || "—"}</div>
                  {e.reason && <div>{e.reason}</div>}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setAuditFor(null)} className="btn btn-secondary text-sm">Close</button>
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
