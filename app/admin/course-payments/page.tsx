"use client";

import { PageHeader, useAdminData, LoadingBlock, TableShell, KpiCard } from "@/components/admin/ui";
import { formatINR, formatISTDate } from "@/lib/dates";
import { deriveEnrollment } from "@/lib/installments";
import type { CourseEnrollment } from "@/lib/types";

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

export default function CoursePaymentsAdmin() {
  const enr = useAdminData<CourseEnrollment[]>("/api/admin/course-enrollments", "enrollments");
  if (enr.loading) return <LoadingBlock />;

  // Only show confirmed enrollments (seat or full paid); ignore abandoned drafts.
  const all = (enr.data || []).filter((e) => e.amount_paid > 0 && e.status !== "cancelled");
  const collected = all.reduce((a, e) => a + e.amount_paid, 0);
  const outstanding = all.reduce((a, e) => a + Math.max(0, e.total_fee - e.amount_paid), 0);
  const overdue = all.filter((e) => deriveEnrollment(e).hasOverdue).length;

  return (
    <div>
      <PageHeader title="Course EMI & Seats" subtitle="Book-Your-Seat plans, installment status & collections (IST)" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Collected" value={formatINR(collected)} tone="green" />
        <KpiCard label="Outstanding" value={formatINR(outstanding)} tone="red" />
        <KpiCard label="Active plans" value={all.length} />
        <KpiCard label="With overdue" value={overdue} tone={overdue ? "amber" : undefined} />
      </div>

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
