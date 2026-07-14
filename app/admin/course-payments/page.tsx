"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
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

const NO_BATCH = "(No batch label)";

interface CohortSummary {
  courseId: string;
  /** When set, this card is a course+batch cohort. */
  batchLabel: string | null;
  title: string;
  subtitle?: string;
  admissions: number;
  courseFeesCollected: number;
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

function summarize(
  list: CourseEnrollment[],
  courseId: string,
  batchLabel: string | null,
  fallbackTitle: string,
  capacity: number | null,
): CohortSummary {
  const totalFees = list.reduce((a, e) => a + e.total_fee, 0);
  const coll = list.reduce((a, e) => a + e.amount_paid, 0);
  const remaining = list.reduce((a, e) => a + Math.max(0, e.total_fee - e.amount_paid), 0);
  const courseTitle = list[0]?.course_title || fallbackTitle;
  return {
    courseId,
    batchLabel,
    title: batchLabel ? (batchLabel === NO_BATCH ? NO_BATCH : batchLabel) : courseTitle,
    subtitle: batchLabel ? courseTitle : undefined,
    admissions: list.length,
    courseFeesCollected: coll,
    totalFees,
    remaining,
    avgFee: list.length ? Math.round(totalFees / list.length) : 0,
    collectionPct: totalFees > 0 ? Math.round((coll / totalFees) * 100) : 0,
    fullyPaid: list.filter((e) => e.status === "fully_paid").length,
    overdue: list.filter((e) => deriveEnrollment(e).hasOverdue).length,
    emiCount: list.filter((e) => e.plan_type === "emi").length,
    discountTotal: list.reduce((a, e) => a + (e.discount_amount || 0), 0),
    capacity,
  };
}

export default function CoursePaymentsAdmin() {
  const router = useRouter();
  const [groupBy, setGroupBy] = useState<"course" | "batch">("course");
  const enr = useAdminData<CourseEnrollment[]>("/api/admin/course-enrollments", "enrollments");
  const courses = useAdminData<Course[]>("/api/admin/courses", "courses");
  if (enr.loading) return <LoadingBlock />;

  // Only show confirmed enrollments (seat or full paid); ignore abandoned drafts.
  const all = (enr.data || []).filter((e) => e.amount_paid > 0 && e.status !== "cancelled");
  const courseFeesCollected = all.reduce((a, e) => a + e.amount_paid, 0);
  const outstanding = all.reduce((a, e) => a + Math.max(0, e.total_fee - e.amount_paid), 0);
  const overdue = all.filter((e) => deriveEnrollment(e).hasOverdue).length;

  // ---- Per-course / per-batch aggregation (read-only analytics) ----
  const courseById = new Map((courses.data || []).map((c) => [c.id, c]));
  const courseGroups = new Map<string, CourseEnrollment[]>();
  const batchGroups = new Map<string, CourseEnrollment[]>();
  for (const e of all) {
    (courseGroups.get(e.course_id) ?? courseGroups.set(e.course_id, []).get(e.course_id)!).push(e);
    const bKey = `${e.course_id}\u0000${e.batch_label || NO_BATCH}`;
    (batchGroups.get(bKey) ?? batchGroups.set(bKey, []).get(bKey)!).push(e);
  }

  const courseSummaries: CohortSummary[] = [...courseGroups.entries()]
    .map(([courseId, list]) =>
      summarize(list, courseId, null, courseById.get(courseId)?.title || "Course", courseCapacity(courseById.get(courseId))),
    )
    .sort((a, b) => b.courseFeesCollected - a.courseFeesCollected);

  const batchSummaries: CohortSummary[] = [...batchGroups.entries()]
    .map(([key, list]) => {
      const [courseId, batchLabel] = key.split("\u0000");
      return summarize(list, courseId, batchLabel, courseById.get(courseId)?.title || "Course", null);
    })
    .sort((a, b) => b.courseFeesCollected - a.courseFeesCollected);

  const summaries = groupBy === "course" ? courseSummaries : batchSummaries;

  return (
    <div>
      <PageHeader
        title="Fees & EMI"
        subtitle="Financial & capacity lens — cohort Course Fees Collected, admissions, seats filled & overdue EMIs (IST). Click a cohort to drill into its roster."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Course Fees Collected"
          value={formatINR(courseFeesCollected)}
          tone="green"
          hint="Course-enrollment fees"
          title="Course Fees Collected — fees received against course enrollments (paid installments across confirmed enrollments). Excludes webinars & other products."
        />
        <KpiCard
          label="Course Fees Outstanding"
          value={formatINR(outstanding)}
          tone="red"
          hint="Not yet received"
          title="Course fees still owed = total course fees − Course Fees Collected."
        />
        <KpiCard label="Active plans" value={all.length} title="Confirmed course enrollments (paid seat/EMI/full), excluding cancelled." />
        <KpiCard label="With overdue" value={overdue} tone={overdue ? "amber" : undefined} title="Confirmed enrollments with at least one past-due unpaid installment." />
      </div>

      {/* Per-course analytics — grouping toggle: course vs course+batch */}
      {summaries.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-ink2">Cohort performance</h2>
            <div className="flex items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border border-line text-xs">
                {(["course", "batch"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={`px-3 py-1.5 font-semibold transition ${groupBy === g ? "bg-primary text-white" : "bg-surface text-muted hover:text-ink2"}`}
                  >
                    {g === "course" ? "By course" : "By batch"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted">{summaries.length} {groupBy === "course" ? (summaries.length === 1 ? "course" : "courses") : summaries.length === 1 ? "batch" : "batches"}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {summaries.map((s) => (
              <CohortCard key={s.batchLabel != null ? `${s.courseId}\u0000${s.batchLabel}` : s.courseId} s={s} />
            ))}
          </div>
        </div>
      )}

      <TableShell headers={["Student", "Phone", "Course", "Plan", "Paid / Total", "Installments", "Status", "Started"]}>
        {all.map((e) => {
          const d = deriveEnrollment(e);
          const nextDue = e.schedule.find((s) => !s.paid && s.due);
          const canOpen = !!e.student_id;
          const open = () => { if (e.student_id) router.push(`/admin/students/${e.student_id}?enrollmentId=${e.id}`); };
          return (
            <tr
              key={e.id}
              onClick={canOpen ? open : undefined}
              onKeyDown={canOpen ? (ev) => { if (ev.key === "Enter") open(); } : undefined}
              tabIndex={canOpen ? 0 : undefined}
              role={canOpen ? "link" : undefined}
              title={canOpen ? `Open ${e.student_name}'s profile` : "No student profile linked to this phone yet"}
              className={`group border-b border-line last:border-0 ${canOpen ? "cursor-pointer hover:bg-surface2 focus:bg-surface2 focus:outline-none" : ""}`}
            >
              <td className="px-4 py-3 font-medium">
                <span className="inline-flex items-center gap-1">
                  <span className={canOpen ? "group-hover:text-primary group-hover:underline" : ""}>{e.student_name}</span>
                  {canOpen && <ChevronRight size={13} className="text-muted opacity-0 transition group-hover:opacity-100" />}
                </span>
              </td>
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

function CohortCard({ s }: { s: CohortSummary }) {
  const pct = Math.min(100, Math.max(0, s.collectionPct));
  const seatPct = s.capacity ? Math.min(100, Math.round((s.admissions / s.capacity) * 100)) : null;
  const href =
    s.batchLabel != null && s.batchLabel !== NO_BATCH
      ? `/admin/course-payments/${encodeURIComponent(s.courseId)}?batch=${encodeURIComponent(s.batchLabel)}`
      : `/admin/course-payments/${encodeURIComponent(s.courseId)}`;
  return (
    <Link
      href={href}
      className="card group flex flex-col gap-4 p-5 transition hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40"
      title={`Drill into ${s.title}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-base font-bold leading-snug group-hover:text-primary" title={s.title}>{s.title}</h3>
          <p className="mt-0.5 truncate text-xs text-muted">
            {s.subtitle ? `${s.subtitle} · ` : ""}{s.admissions} admission{s.admissions === 1 ? "" : "s"}
            {s.emiCount > 0 ? ` · ${s.emiCount} on EMI` : ""}
          </p>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-lg">🎓</span>
      </div>

      {/* Headline: Course Fees Collected */}
      <div title="Course Fees Collected — course-enrollment fees received. Excludes webinars & other products.">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Course Fees Collected</p>
        <p className="font-heading text-2xl font-extrabold tabular-nums">{formatINR(s.courseFeesCollected)}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-[var(--primary-hover)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
          <span>{pct}% of {formatINR(s.totalFees)}</span>
          <span className="font-semibold text-warning">{formatINR(s.remaining)} outstanding</span>
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

      <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition group-hover:opacity-100">
        View cohort roster <ChevronRight size={13} />
      </span>
    </Link>
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
