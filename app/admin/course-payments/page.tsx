"use client";

import { PageHeader, useAdminData, LoadingBlock, TableShell, KpiCard } from "@/components/admin/ui";
import { formatINR, formatISTDate } from "@/lib/dates";
import { deriveEnrollment } from "@/lib/installments";
import type { CourseEnrollment, Course } from "@/lib/types";

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

interface CourseSummary {
  courseId: string;
  title: string;
  admissions: number;
  collected: number;
  totalFees: number;
  remaining: number;
  avgFee: number;
  collectionPct: number;
  fullyPaid: number;
  overdue: number;
  emiCount: number;
  discountTotal: number;
  capacity: number | null;
}

/** Total seats for a course: prefer course-level capacity, else sum batch capacities. */
function courseCapacity(course: Course | undefined): number | null {
  if (!course) return null;
  if (course.capacity != null && course.capacity > 0) return course.capacity;
  const batchCap = (course.batches || []).reduce((a, b) => a + (b.capacity || 0), 0);
  return batchCap > 0 ? batchCap : null;
}

export default function CoursePaymentsAdmin() {
  const enr = useAdminData<CourseEnrollment[]>("/api/admin/course-enrollments", "enrollments");
  const courses = useAdminData<Course[]>("/api/admin/courses", "courses");
  if (enr.loading) return <LoadingBlock />;

  // Only show confirmed enrollments (seat or full paid); ignore abandoned drafts.
  const all = (enr.data || []).filter((e) => e.amount_paid > 0 && e.status !== "cancelled");
  const collected = all.reduce((a, e) => a + e.amount_paid, 0);
  const outstanding = all.reduce((a, e) => a + Math.max(0, e.total_fee - e.amount_paid), 0);
  const overdue = all.filter((e) => deriveEnrollment(e).hasOverdue).length;

  // ---- Per-course aggregation (read-only analytics) ----
  const courseById = new Map((courses.data || []).map((c) => [c.id, c]));
  const groups = new Map<string, CourseEnrollment[]>();
  for (const e of all) {
    const arr = groups.get(e.course_id);
    if (arr) arr.push(e);
    else groups.set(e.course_id, [e]);
  }
  const summaries: CourseSummary[] = [...groups.entries()].map(([courseId, list]) => {
    const totalFees = list.reduce((a, e) => a + e.total_fee, 0);
    const coll = list.reduce((a, e) => a + e.amount_paid, 0);
    const remaining = list.reduce((a, e) => a + Math.max(0, e.total_fee - e.amount_paid), 0);
    return {
      courseId,
      title: list[0].course_title || courseById.get(courseId)?.title || "Course",
      admissions: list.length,
      collected: coll,
      totalFees,
      remaining,
      avgFee: list.length ? Math.round(totalFees / list.length) : 0,
      collectionPct: totalFees > 0 ? Math.round((coll / totalFees) * 100) : 0,
      fullyPaid: list.filter((e) => e.status === "fully_paid").length,
      overdue: list.filter((e) => deriveEnrollment(e).hasOverdue).length,
      emiCount: list.filter((e) => e.plan_type === "emi").length,
      discountTotal: list.reduce((a, e) => a + (e.discount_amount || 0), 0),
      capacity: courseCapacity(courseById.get(courseId)),
    };
  }).sort((a, b) => b.collected - a.collected);

  return (
    <div>
      <PageHeader title="Course EMI & Seats" subtitle="Book-Your-Seat plans, installment status & collections (IST)" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Collected" value={formatINR(collected)} tone="green" />
        <KpiCard label="Outstanding" value={formatINR(outstanding)} tone="red" />
        <KpiCard label="Active plans" value={all.length} />
        <KpiCard label="With overdue" value={overdue} tone={overdue ? "amber" : undefined} />
      </div>

      {/* Premium per-course analytics — one card per course with admissions */}
      {summaries.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-ink2">Course performance</h2>
            <span className="text-xs text-muted">{summaries.length} {summaries.length === 1 ? "course" : "courses"} with admissions</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {summaries.map((s) => (
              <CourseAnalyticsCard key={s.courseId} s={s} />
            ))}
          </div>
        </div>
      )}

      <TableShell headers={["Student", "Phone", "Course", "Plan", "Paid / Total", "Installments", "Status", "Started"]}>
        {all.map((e) => {
          const d = deriveEnrollment(e);
          const nextDue = e.schedule.find((s) => !s.paid && s.due);
          return (
            <tr key={e.id} className="border-b border-line last:border-0 hover:bg-surface2">
              <td className="px-4 py-3 font-medium">{e.student_name}</td>
              <td className="px-4 py-3">{e.phone}</td>
              <td className="px-4 py-3 text-xs">{e.course_title}</td>
              <td className="px-4 py-3 text-xs uppercase">{e.plan_type === "emi" ? `EMI ×${e.installment_count}` : "Full"}</td>
              <td className="px-4 py-3">
                <div className="font-medium">{formatINR(d.paid)} <span className="text-muted">/ {formatINR(e.total_fee)}</span></div>
                {d.remaining > 0 && <div className="text-xs text-muted">Bal {formatINR(d.remaining)}{nextDue ? ` · next ${formatISTDate(nextDue.due)}` : ""}</div>}
              </td>
              <td className="px-4 py-3 text-xs">
                {e.plan_type === "emi" ? (
                  <>
                    {d.paidCount}/{d.installmentTotal} paid
                    {d.hasOverdue && <span className="ml-1 font-bold text-danger">· OVERDUE</span>}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3"><span className={`pill ${STATUS_PILL[e.status] || "pill-gray"}`}>{STATUS_LABEL[e.status] || e.status}</span></td>
              <td className="px-4 py-3 text-xs">{formatISTDate(e.created_at)}</td>
            </tr>
          );
        })}
      </TableShell>
      {all.length === 0 && <p className="mt-6 text-center text-sm text-muted">No seat/EMI enrollments yet.</p>}
    </div>
  );
}

function CourseAnalyticsCard({ s }: { s: CourseSummary }) {
  const pct = Math.min(100, Math.max(0, s.collectionPct));
  const seatPct = s.capacity ? Math.min(100, Math.round((s.admissions / s.capacity) * 100)) : null;
  return (
    <div className="card flex flex-col gap-4 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-base font-bold leading-snug" title={s.title}>{s.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {s.admissions} admission{s.admissions === 1 ? "" : "s"}
            {s.emiCount > 0 ? ` · ${s.emiCount} on EMI` : ""}
          </p>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-lg">🎓</span>
      </div>

      {/* Headline: collected */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Fees collected</p>
        <p className="font-heading text-2xl font-extrabold tabular-nums">{formatINR(s.collected)}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-[var(--primary-hover)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
          <span>{pct}% of {formatINR(s.totalFees)}</span>
          <span className="font-semibold text-warning">{formatINR(s.remaining)} remaining</span>
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Avg fee" value={formatINR(s.avgFee)} />
        <Metric label="Fully paid" value={`${s.fullyPaid}/${s.admissions}`} />
        {seatPct != null ? (
          <Metric label="Seats filled" value={`${s.admissions}/${s.capacity}`} sub={`${seatPct}%`} />
        ) : (
          <Metric label="Collection" value={`${pct}%`} />
        )}
        <Metric
          label="Overdue"
          value={String(s.overdue)}
          tone={s.overdue > 0 ? "danger" : undefined}
        />
      </div>

      {s.discountTotal > 0 && (
        <p className="inline-flex w-fit items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
          {formatINR(s.discountTotal)} in discounts given
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return (
    <div className="rounded-xl bg-surface2 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 font-heading text-lg font-extrabold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>
        {value}
        {sub && <span className="ml-1 text-xs font-semibold text-muted">{sub}</span>}
      </p>
    </div>
  );
}
