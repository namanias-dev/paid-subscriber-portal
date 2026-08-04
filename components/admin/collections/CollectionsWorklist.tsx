"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Phone, Search } from "lucide-react";
import { useAdminData, LoadingBlock } from "@/components/admin/ui";
import StudentNameLink from "@/components/admin/StudentNameLink";
import InstallmentReminderButton from "@/components/admin/sms/InstallmentReminderButton";
import BulkInstallmentReminder from "@/components/admin/sms/BulkInstallmentReminder";
import ReminderStatePill from "@/components/admin/sms/ReminderStatePill";
import PendingFollowUps from "@/components/admin/sms/PendingFollowUps";
import { formatINR, formatISTDate } from "@/lib/dates";
import { deriveCollections } from "@/lib/installments";
import { isOutstandingInstallment } from "@/lib/sms/installmentAttribution";
import { normalizeIndianMobile } from "@/lib/phone";
import type { TrackingPayload } from "@/lib/sms/installmentTracking";
import type { CourseEnrollment, Course } from "@/lib/types";

type EnrollmentRow = CourseEnrollment & { student_id: string | null };
type SortKey = "overdue" | "daysOverdue" | "nextDue" | "name" | "course";
type LiveAccessChip = { status: string; reason?: string };

/** Default for the "reminded, still unpaid after N days" filter. */
const DEFAULT_STALE_DAYS = 3;

/**
 * Collections worklist — powers "Fees at Risk (Collections)". Read-only on the
 * money: chases overdue EMI/fees, and can send the DLT-approved installment
 * reminder in bulk.
 *
 * Reuses /api/admin/course-enrollments + deriveCollections — the SAME source as
 * the Course EMI cards and cohort drill-in, so every figure reconciles, and the
 * bulk reminder resolves its amounts from that same schedule rather than from
 * anything computed here.
 *
 * DEFAULT VIEW IS UNCHANGED. "Overdue only" starts ON, which is exactly the
 * filter this page always applied, so with nothing selected the same rows appear
 * in the same order with the same figures. The additions are a selection column,
 * a reminder-state column and a header line.
 */
export default function CollectionsWorklist() {
  const enr = useAdminData<EnrollmentRow[]>("/api/admin/course-enrollments", "enrollments");
  const courses = useAdminData<Course[]>("/api/admin/courses", "courses");

  const [courseId, setCourseId] = useState("all");
  const [batch, setBatch] = useState("all");
  const [sort, setSort] = useState<SortKey>("overdue");
  const [q, setQ] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(true);
  /** When on, only rows whose live lectureAccess is blocked/grace — matches Access at Risk. */
  const [liveAccessRiskOnly, setLiveAccessRiskOnly] = useState(true);
  const [staleOnly, setStaleOnly] = useState(false);
  const [staleDays, setStaleDays] = useState(DEFAULT_STALE_DAYS);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [tracking, setTracking] = useState<TrackingPayload | null>(null);
  const [sendCount, setSendCount] = useState(0);
  /** Live schedule access from /api/admin/access-risk (lectureAccessForCourse server-side). */
  const [liveRisk, setLiveRisk] = useState<Map<string, LiveAccessChip>>(new Map());
  const loadTracking = useCallback(() => {
    fetch("/api/admin/sms/installment-reminder/tracking")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setTracking(j.tracking as TrackingPayload); })
      .catch(() => { /* the table still works without pills */ });
  }, []);
  const loadLiveRisk = useCallback(() => {
    fetch("/api/admin/access-risk")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.ok || !Array.isArray(j.rows)) return;
        const m = new Map<string, LiveAccessChip>();
        for (const row of j.rows) {
          m.set(row.enrollmentId, {
            status: row.scheduleAccess?.status || "—",
            reason: row.scheduleAccess?.reason,
          });
        }
        setLiveRisk(m);
      })
      .catch(() => { /* collections still works on money heuristic */ });
  }, []);
  useEffect(loadTracking, [loadTracking]);
  useEffect(loadLiveRisk, [loadLiveRisk]);
  const afterSend = useCallback(() => { loadTracking(); setSendCount((n) => n + 1); }, [loadTracking]);

  // Live access risk (default) uses Access at Risk rows — same lectureAccessForCourse source.
  const scoped = useMemo(() => {
    return (enr.data || [])
      .filter((e) => e.amount_paid > 0 && e.status !== "cancelled")
      .map((e) => {
        const d = deriveCollections(e);
        const chip = liveRisk.get(e.id);
        const scheduleAccess = chip || { status: "unknown" };
        return { e, d, scheduleAccess };
      })
      .filter(({ e, d, scheduleAccess }) => {
        if (liveAccessRiskOnly) {
          if (liveRisk.size === 0) return d.overdueAmount > 0; // loading fallback
          return liveRisk.has(e.id);
        }
        return overdueOnly ? d.overdueAmount > 0 : d.remaining > 0;
      });
  }, [enr.data, overdueOnly, liveAccessRiskOnly, liveRisk]);

  const courseOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const { e } of scoped) m.set(e.course_id, e.course_title || courses.data?.find((c) => c.id === e.course_id)?.title || "Course");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [scoped, courses.data]);

  const batchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const { e } of scoped) {
      if (courseId !== "all" && e.course_id !== courseId) continue;
      if (e.batch_label) set.add(e.batch_label);
    }
    return [...set].sort();
  }, [scoped, courseId]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = scoped.filter(({ e }) => {
      if (courseId !== "all" && e.course_id !== courseId) return false;
      if (batch !== "all" && (e.batch_label || "") !== batch) return false;
      if (term && !`${e.student_name} ${e.phone}`.toLowerCase().includes(term)) return false;
      if (staleOnly) {
        // Reminded at least `staleDays` ago and STILL owing on that installment.
        const s = tracking?.byEnrollment[e.id]?.row;
        if (!s || s.outstanding <= 0) return false;
        if (s.daysSinceFirstReminder == null || s.daysSinceFirstReminder < staleDays) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case "daysOverdue":
          return b.d.daysOverdue - a.d.daysOverdue || b.d.overdueAmount - a.d.overdueAmount;
        case "nextDue": {
          const at = a.d.nextDueDate ? new Date(a.d.nextDueDate).getTime() : Infinity;
          const bt = b.d.nextDueDate ? new Date(b.d.nextDueDate).getTime() : Infinity;
          return at - bt;
        }
        case "name":
          return a.e.student_name.localeCompare(b.e.student_name);
        case "course":
          return (a.e.course_title || "").localeCompare(b.e.course_title || "") || b.d.overdueAmount - a.d.overdueAmount;
        case "overdue":
        default:
          return b.d.overdueAmount - a.d.overdueAmount || b.d.daysOverdue - a.d.daysOverdue;
      }
    });
    return list;
  }, [scoped, courseId, batch, q, sort, staleOnly, staleDays, tracking]);

  const scopeOverdue = rows.reduce((a, { d }) => a + d.overdueAmount, 0);

  // Drop selections that fall outside the current filter, so the sticky bar can
  // never claim to send to someone who is no longer on screen.
  const visibleIds = useMemo(() => new Set(rows.map(({ e }) => e.id)), [rows]);
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  /**
   * Live pre-check beside the action bar. Deliberately uses the SAME pure
   * helpers the server resolver uses (isOutstandingInstallment,
   * normalizeIndianMobile) rather than a second implementation — but the review
   * screen remains authoritative, because opt-out and template state are only
   * knowable server-side.
   */
  const counts = useMemo(() => {
    let withPhone = 0, eligible = 0;
    for (const { e } of rows) {
      const phoneOk = normalizeIndianMobile(e.phone || "").ok;
      if (phoneOk) withPhone++;
      const hasInstallment = (e.schedule || []).some(isOutstandingInstallment);
      if (phoneOk && hasInstallment) eligible++;
    }
    return { total: rows.length, withPhone, excluded: rows.length - eligible };
  }, [rows]);

  const aggregate = useMemo(() => {
    if (!tracking) return null;
    // Recomputed for the CURRENT filter, not the whole table.
    const states = rows.map(({ e }) => tracking.byEnrollment[e.id]?.row ?? null);
    let reminded = 0, paidAfter = 0, pending = 0;
    const days: number[] = [];
    for (const s of states) {
      if (!s) continue;
      const wasReminded = s.reminderCount > 0 || s.kind === "reminded_unattributable";
      if (wasReminded) reminded++;
      if (s.kind === "paid_after_reminder") { paidAfter++; if (s.daysToPayment != null) days.push(s.daysToPayment); }
      if (wasReminded && s.outstanding > 0) pending++;
    }
    const sorted = [...days].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianDays = sorted.length
      ? (sorted.length % 2 ? sorted[mid]! : Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10)
      : null;
    return { reminded, paidAfter, medianDays, pending };
  }, [rows, tracking]);

  const toggleRow = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = rows.length > 0 && rows.every(({ e }) => selected.has(e.id));
  const someSelected = selected.size > 0 && !allSelected;

  if (enr.loading) return <LoadingBlock />;

  const scopeLabel =
    courseId === "all"
      ? "all courses"
      : (courseOptions.find(([id]) => id === courseId)?.[1] || "course") + (batch !== "all" ? ` · ${batch}` : "");

  return (
    <div>
      {/* CFO/collections headline — updates with the filter */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-gradient-to-r from-[var(--danger)]/8 to-transparent p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-danger/10 text-danger"><AlertTriangle size={20} /></span>
          <div>
            <p className="font-heading text-2xl font-extrabold tabular-nums text-danger">{formatINR(scopeOverdue)} overdue</p>
            <p className="text-sm text-ink2">
              across {rows.length} student{rows.length === 1 ? "" : "s"} in {scopeLabel}
              {liveAccessRiskOnly ? " · live access blocked/grace (matches Access at Risk)" : ""}
            </p>
            {/* Correlation only — describes timing, never claims a reminder caused a payment. */}
            {aggregate && (
              <p className="mt-1 text-xs text-muted" title="Timing only. A student who paid after a reminder may have paid regardless.">
                Reminded: {aggregate.reminded} · Paid after reminder: {aggregate.paidAfter}
                {aggregate.medianDays != null ? ` (median ${aggregate.medianDays}d)` : ""} · Still pending: {aggregate.pending}
              </p>
            )}
          </div>
        </div>
        <p className="max-w-xs text-xs text-muted">Collections desk — chase overdue EMIs. Display only; use the student profile to record a payment.</p>
      </div>

      {/* Filters */}
      <div className="card mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className="input w-full pl-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <select
            value={courseId}
            onChange={(e) => { setCourseId(e.target.value); setBatch("all"); }}
            className="input min-w-0 text-sm"
            aria-label="Filter by course"
          >
            <option value="all">All courses</option>
            {courseOptions.map(([id, t]) => (
              <option key={id} value={id}>{t}</option>
            ))}
          </select>
          <select value={batch} onChange={(e) => setBatch(e.target.value)} className="input min-w-0 text-sm" aria-label="Filter by batch" disabled={batchOptions.length === 0}>
            <option value="all">All batches</option>
            {batchOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input min-w-0 text-sm" aria-label="Sort by">
            <option value="overdue">Sort: Overdue ₹ (high→low)</option>
            <option value="daysOverdue">Sort: Days overdue (most)</option>
            <option value="nextDue">Sort: Next due (soonest)</option>
            <option value="name">Sort: Name (A→Z)</option>
            <option value="course">Sort: Course / batch</option>
          </select>
        </div>
      </div>

      {/* Reminder-specific filters. Overdue-only is ON by default — the safe case. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-ink2">
        <label className="inline-flex items-center gap-2" title="Only students whose live lectureAccessForCourse is blocked or in grace — same list as Access at Risk">
          <input type="checkbox" checked={liveAccessRiskOnly} onChange={(e) => setLiveAccessRiskOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--primary)]" />
          Live access risk only
        </label>
        <label className="inline-flex items-center gap-2" title="Only students whose next due installment is already past due (money heuristic; ignored when live access risk is on)">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} disabled={liveAccessRiskOnly} className="h-3.5 w-3.5 accent-[color:var(--primary)] disabled:opacity-40" />
          Overdue only
        </label>
        <label className="inline-flex items-center gap-2" title="Students already reminded who still have not paid that installment">
          <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[color:var(--primary)]" />
          Reminded, still unpaid after
          <input
            type="number"
            min={0}
            max={365}
            value={staleDays}
            onChange={(e) => setStaleDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
            className="input h-7 w-14 px-2 py-0 text-xs"
            aria-label="Days since the first reminder"
          />
          days
        </label>
        <span className="text-muted">
          {counts.total} student{counts.total === 1 ? "" : "s"} · {counts.withPhone} with valid phone · {counts.excluded} excluded
        </span>
      </div>

      {/* Queued instructions messages, cancellable until they fire */}
      <PendingFollowUps refreshKey={sendCount} />

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-success/10 text-2xl">✅</span>
          <p className="font-medium text-ink">No overdue fees in this scope</p>
          <p className="text-sm text-muted">Nothing to chase right now. Adjust the filter to widen the scope.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="w-9 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(({ e }) => e.id)))}
                    className="h-3.5 w-3.5 accent-[color:var(--primary)]"
                    title="Select all students matching the current filters"
                    aria-label="Select all students matching the current filters"
                  />
                </th>
                {["Student", "Course / Batch", "Access", "Overdue", "Days", "Missed", "Balance", "Next due", "Reminder", ""].map((h) => (
                  <th key={h || "actions"} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, d, scheduleAccess }) => (
                <tr key={e.id} className={`border-b border-line last:border-0 hover:bg-surface2 ${selected.has(e.id) ? "bg-primary/5" : ""}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggleRow(e.id)}
                      onClick={(ev) => ev.stopPropagation()}
                      className="h-3.5 w-3.5 accent-[color:var(--primary)]"
                      aria-label={`Select ${e.student_name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <StudentNameLink studentId={e.student_id} enrollmentId={e.id} name={e.student_name} />
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1 hover:text-primary" onClick={(ev) => ev.stopPropagation()}>
                        <Phone size={11} /> {e.phone}
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink2">{e.course_title}</div>
                    {e.batch_label && <div className="text-xs text-muted">{e.batch_label}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`pill text-[10px] ${scheduleAccess.status === "blocked" ? "pill-red" : scheduleAccess.status === "grace" ? "pill-amber" : "pill-gray"}`}>
                      {scheduleAccess.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-danger">{formatINR(d.overdueAmount)}</td>
                  <td className="px-4 py-3 tabular-nums">{d.daysOverdue}d</td>
                  <td className="px-4 py-3 tabular-nums">{d.missedInstallments}</td>
                  <td className="px-4 py-3 tabular-nums text-ink2">{formatINR(d.remaining)}</td>
                  <td className="px-4 py-3 tabular-nums text-ink2">{d.nextDueDate ? formatISTDate(d.nextDueDate) : "—"}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      // The follow-up shown must be the one for the SAME
                      // installment as the pill, never just the newest on the row.
                      const t = tracking?.byEnrollment[e.id];
                      const row = t?.row ?? null;
                      return <ReminderStatePill state={row} followUp={row ? (t?.followUps?.[row.installmentNo] ?? null) : null} />;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <InstallmentReminderButton enrollmentId={e.id} />
                      {e.student_id ? (
                        <Link href={`/admin/students/${e.student_id}?enrollmentId=${e.id}`} className="text-xs font-semibold text-primary hover:underline">View</Link>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkInstallmentReminder
        selectedIds={[...selected].filter((id) => visibleIds.has(id))}
        overdueOnly={overdueOnly}
        onClear={() => setSelected(new Set())}
        onSent={afterSend}
      />
    </div>
  );
}
