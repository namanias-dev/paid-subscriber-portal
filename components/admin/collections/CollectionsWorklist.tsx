"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Phone, Search } from "lucide-react";
import { useAdminData, LoadingBlock } from "@/components/admin/ui";
import { formatINR, formatISTDate } from "@/lib/dates";
import { deriveCollections } from "@/lib/installments";
import type { CourseEnrollment, Course } from "@/lib/types";

type EnrollmentRow = CourseEnrollment & { student_id: string | null };
type SortKey = "overdue" | "daysOverdue" | "nextDue" | "name" | "course";

/**
 * Collections worklist — powers "Fees at Risk (Collections)". Read-only: chases overdue EMI/fees.
 * Reuses /api/admin/course-enrollments + deriveCollections — the SAME source
 * as the Course EMI cards and cohort drill-in, so every figure reconciles.
 */
export default function CollectionsWorklist() {
  const enr = useAdminData<EnrollmentRow[]>("/api/admin/course-enrollments", "enrollments");
  const courses = useAdminData<Course[]>("/api/admin/courses", "courses");

  const [courseId, setCourseId] = useState("all");
  const [batch, setBatch] = useState("all");
  const [sort, setSort] = useState<SortKey>("overdue");
  const [q, setQ] = useState("");

  // All confirmed, non-cancelled enrollments that are actually overdue.
  const overdue = useMemo(() => {
    return (enr.data || [])
      .filter((e) => e.amount_paid > 0 && e.status !== "cancelled")
      .map((e) => ({ e, d: deriveCollections(e) }))
      .filter(({ d }) => d.overdueAmount > 0);
  }, [enr.data]);

  const courseOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const { e } of overdue) m.set(e.course_id, e.course_title || courses.data?.find((c) => c.id === e.course_id)?.title || "Course");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [overdue, courses.data]);

  const batchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const { e } of overdue) {
      if (courseId !== "all" && e.course_id !== courseId) continue;
      if (e.batch_label) set.add(e.batch_label);
    }
    return [...set].sort();
  }, [overdue, courseId]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = overdue.filter(({ e }) => {
      if (courseId !== "all" && e.course_id !== courseId) return false;
      if (batch !== "all" && (e.batch_label || "") !== batch) return false;
      if (term && !`${e.student_name} ${e.phone}`.toLowerCase().includes(term)) return false;
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
  }, [overdue, courseId, batch, q, sort]);

  const scopeOverdue = rows.reduce((a, { d }) => a + d.overdueAmount, 0);

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
            <p className="text-sm text-ink2">across {rows.length} student{rows.length === 1 ? "" : "s"} in {scopeLabel}</p>
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

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-success/10 text-2xl">✅</span>
          <p className="font-medium text-ink">No overdue fees in this scope</p>
          <p className="text-sm text-muted">Nothing to chase right now. Adjust the filter to widen the scope.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                {["Student", "Course / Batch", "Overdue", "Days", "Missed", "Balance", "Next due", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, d }) => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-surface2">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{e.student_name}</div>
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
                  <td className="px-4 py-3 font-semibold tabular-nums text-danger">{formatINR(d.overdueAmount)}</td>
                  <td className="px-4 py-3 tabular-nums">{d.daysOverdue}d</td>
                  <td className="px-4 py-3 tabular-nums">{d.missedInstallments}</td>
                  <td className="px-4 py-3 tabular-nums text-ink2">{formatINR(d.remaining)}</td>
                  <td className="px-4 py-3 tabular-nums text-ink2">{d.nextDueDate ? formatISTDate(d.nextDueDate) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {e.student_id ? (
                      <Link href={`/admin/students/${e.student_id}?enrollmentId=${e.id}`} className="text-xs font-semibold text-primary hover:underline">View</Link>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
