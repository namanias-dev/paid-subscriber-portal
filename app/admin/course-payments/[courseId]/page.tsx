"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useAdminData, LoadingBlock } from "@/components/admin/ui";
import PeopleTabs from "@/components/admin/people/PeopleTabs";
import { HeaderStat, InstallmentSchedule } from "@/components/admin/collections/parts";
import { formatINR, formatISTDate } from "@/lib/dates";
import { deriveCollections } from "@/lib/installments";
import type { CourseEnrollment, Course } from "@/lib/types";

type EnrollmentRow = CourseEnrollment & { student_id: string | null };

const STATUS_PILL: Record<string, string> = {
  pending: "pill-gray",
  seat_booked: "pill-amber",
  partially_paid: "pill-blue",
  fully_paid: "pill-green",
  cancelled: "pill-red",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  seat_booked: "Seat Booked",
  partially_paid: "Partially Paid",
  fully_paid: "Fully Paid",
  cancelled: "Cancelled",
};

type SortKey = "overdue" | "balance" | "nextDue" | "name";
type Scope = "all" | "dues" | "overdue";

/** Total seats: prefer course-level capacity, else sum batch capacities. Mirrors the cards page. */
function courseCapacity(course: Course | undefined): number | null {
  if (!course) return null;
  if (course.capacity != null && course.capacity > 0) return course.capacity;
  const batchCap = (course.batches || []).reduce((a, b) => a + (b.capacity || 0), 0);
  return batchCap > 0 ? batchCap : null;
}

export default function CohortDrillIn() {
  const params = useParams<{ courseId: string }>();
  const courseId = decodeURIComponent(String(params.courseId));
  const router = useRouter();
  const search = useSearchParams();
  const batchParam = search.get("batch");

  const enr = useAdminData<EnrollmentRow[]>("/api/admin/course-enrollments", "enrollments");
  const courses = useAdminData<Course[]>("/api/admin/courses", "courses");

  const [sort, setSort] = useState<SortKey>("overdue");
  const [scope, setScope] = useState<Scope>("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const course = (courses.data || []).find((c) => c.id === courseId);

  // Same filter as the Course EMI cards: confirmed (paid > 0) and not cancelled.
  const cohortAll = useMemo(
    () => (enr.data || []).filter((e) => e.course_id === courseId && e.amount_paid > 0 && e.status !== "cancelled"),
    [enr.data, courseId],
  );

  const batches = useMemo(() => {
    const set = new Set<string>();
    for (const e of cohortAll) if (e.batch_label) set.add(e.batch_label);
    return [...set].sort();
  }, [cohortAll]);

  // Batch scope (drives header + roster together so they always reconcile).
  const cohort = useMemo(
    () => (batchParam ? cohortAll.filter((e) => (e.batch_label || "") === batchParam) : cohortAll),
    [cohortAll, batchParam],
  );

  const derived = useMemo(
    () => cohort.map((e) => ({ e, d: deriveCollections(e) })),
    [cohort],
  );

  // Header stats = reductions over the SAME rows rendered below → reconciles by construction.
  const totals = useMemo(() => {
    return derived.reduce(
      (acc, { e, d }) => {
        acc.collected += d.paid;
        acc.totalFees += e.total_fee;
        acc.remaining += d.remaining;
        acc.overdueAmount += d.overdueAmount;
        // Count uses the SAME predicate as the cards' "Overdue" metric (hasOverdue) so it reconciles exactly.
        if (d.hasOverdue) acc.overdueStudents += 1;
        if (e.status === "fully_paid") acc.fullyPaid += 1;
        acc.discount += e.discount_amount || 0;
        return acc;
      },
      { collected: 0, totalFees: 0, remaining: 0, overdueAmount: 0, overdueStudents: 0, fullyPaid: 0, discount: 0 },
    );
  }, [derived]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = derived.filter(({ e, d }) => {
      if (term && !`${e.student_name} ${e.phone}`.toLowerCase().includes(term)) return false;
      if (scope === "dues" && d.remaining <= 0) return false;
      if (scope === "overdue" && d.overdueAmount <= 0) return false;
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case "balance":
          return b.d.remaining - a.d.remaining;
        case "name":
          return a.e.student_name.localeCompare(b.e.student_name);
        case "nextDue": {
          const at = a.d.nextDueDate ? new Date(a.d.nextDueDate).getTime() : Infinity;
          const bt = b.d.nextDueDate ? new Date(b.d.nextDueDate).getTime() : Infinity;
          return at - bt;
        }
        case "overdue":
        default:
          return b.d.overdueAmount - a.d.overdueAmount || b.d.remaining - a.d.remaining;
      }
    });
    return list;
  }, [derived, q, scope, sort]);

  if (enr.loading || courses.loading) return <LoadingBlock />;

  const capacity = courseCapacity(course);
  const title = cohort[0]?.course_title || course?.title || "Course";
  const seatPct = capacity ? Math.min(100, Math.round((cohort.length / capacity) * 100)) : null;
  const collectionPct = totals.totalFees > 0 ? Math.round((totals.collected / totals.totalFees) * 100) : 0;

  return (
    <div>
      <PeopleTabs active="fees" />
      {/* Breadcrumb + back */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/course-payments" className="inline-flex items-center gap-1 hover:text-primary">
          <ChevronLeft size={15} /> Course EMI &amp; Seats
        </Link>
        <span>/</span>
        <span className="font-medium text-ink2">Cohort</span>
      </div>

      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">{title}</h1>
          <p className="mt-1 text-sm text-ink2">
            Financial &amp; capacity lens — Course Fees Collected, admissions, seats &amp; overdue for this cohort.
          </p>
        </div>
        {batches.length > 0 && (
          <select
            value={batchParam || ""}
            onChange={(e) => {
              const v = e.target.value;
              router.replace(v ? `/admin/course-payments/${encodeURIComponent(courseId)}?batch=${encodeURIComponent(v)}` : `/admin/course-payments/${encodeURIComponent(courseId)}`);
            }}
            className="input min-w-0 text-sm"
            aria-label="Filter by batch"
          >
            <option value="">All batches ({cohortAll.length})</option>
            {batches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        )}
      </div>

      {/* Header stats — restate the card headline for this cohort */}
      <div className="mb-5 mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HeaderStat label="Course Fees Collected" value={formatINR(totals.collected)} sub={`${collectionPct}% of ${formatINR(totals.totalFees)}`} tone="success" title="Course-enrollment fees received for this cohort. Excludes webinars & other products." />
        <HeaderStat label="Course Fees Outstanding" value={formatINR(totals.remaining)} tone={totals.remaining > 0 ? "warning" : undefined} title="Course fees still owed by this cohort = total fees − Course Fees Collected." />
        <HeaderStat label="Overdue" value={formatINR(totals.overdueAmount)} sub={totals.overdueStudents ? `${totals.overdueStudents} student${totals.overdueStudents === 1 ? "" : "s"}` : "none"} tone={totals.overdueAmount > 0 ? "danger" : undefined} />
        <HeaderStat label="Admissions" value={String(cohort.length)} sub={`${totals.fullyPaid} fully paid`} />
        <HeaderStat label="Seats filled" value={capacity ? `${cohort.length}/${capacity}` : String(cohort.length)} sub={seatPct != null ? `${seatPct}%` : "no capacity set"} />
        <HeaderStat label="Discounts given" value={formatINR(totals.discount)} />
      </div>

      {/* Mini collections controls */}
      <div className="card mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className="input w-full pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "dues", "overdue"] as Scope[]).map((s) => (
            <button key={s} onClick={() => setScope(s)} className={`pill ${scope === s ? "pill-blue" : "pill-gray"}`}>
              {s === "all" ? "All" : s === "dues" ? "With dues" : "Overdue"}
            </button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input min-w-0 text-sm">
            <option value="overdue">Sort: Overdue (high→low)</option>
            <option value="balance">Sort: Balance (high→low)</option>
            <option value="nextDue">Sort: Next due (soonest)</option>
            <option value="name">Sort: Name (A→Z)</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card py-16 text-center text-sm text-muted">
          {cohort.length === 0 ? "No admissions in this cohort yet." : "No students match this filter."}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                {["Student", "Total fee", "Paid", "Balance", "Overdue", "Next due", "Status", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, d }) => {
                const isOpen = expanded === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : e.id)}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-surface2"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{e.student_name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                          <span>{e.phone}</span>
                          {e.plan_type === "emi" && <span className="uppercase">EMI ×{e.installment_count}</span>}
                          {batchParam == null && e.batch_label && <span className="truncate">· {e.batch_label}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatINR(e.total_fee)}</td>
                      <td className="px-4 py-3 font-medium tabular-nums text-success">{formatINR(d.paid)}</td>
                      <td className="px-4 py-3 tabular-nums">{d.remaining > 0 ? formatINR(d.remaining) : "—"}</td>
                      <td className={`px-4 py-3 tabular-nums font-semibold ${d.overdueAmount > 0 ? "text-danger" : "text-muted"}`}>
                        {d.overdueAmount > 0 ? formatINR(d.overdueAmount) : "—"}
                        {d.missedInstallments > 0 && <span className="ml-1 text-[11px] font-normal text-muted">({d.missedInstallments} missed)</span>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ink2">{d.nextDueDate ? formatISTDate(d.nextDueDate) : "—"}</td>
                      <td className="px-4 py-3"><span className={`pill ${STATUS_PILL[e.status] || "pill-gray"}`}>{STATUS_LABEL[e.status] || e.status}</span></td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight size={15} className={`text-muted transition ${isOpen ? "rotate-90" : ""}`} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-surface2/40">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-ink2">Installment schedule</span>
                            {e.student_id && (
                              <Link href={`/admin/students/${e.student_id}?enrollmentId=${e.id}`} className="text-xs font-semibold text-primary hover:underline">
                                Open student profile →
                              </Link>
                            )}
                          </div>
                          <InstallmentSchedule schedule={e.schedule} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 px-1 text-xs text-muted">
        Showing {rows.length} of {cohort.length} admission{cohort.length === 1 ? "" : "s"} · totals above reconcile to this roster.
      </p>
    </div>
  );
}
