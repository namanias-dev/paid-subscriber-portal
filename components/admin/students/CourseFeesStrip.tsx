"use client";

import Link from "next/link";
import { ArrowRight, IndianRupee } from "lucide-react";
import { useAdminData } from "@/components/admin/ui";
import { formatINR } from "@/lib/dates";
import { deriveCollections } from "@/lib/installments";
import type { CourseEnrollment } from "@/lib/types";

/**
 * Compact FINANCE-lens strip on the (operational) Students page. It does NOT
 * duplicate the Course EMI & Seats feature — it reads the SAME source
 * (/api/admin/course-enrollments + deriveCollections) so every figure matches
 * that page exactly, and deep-links to it (the single source of truth).
 */
export default function CourseFeesStrip() {
  const enr = useAdminData<CourseEnrollment[]>("/api/admin/course-enrollments", "enrollments");
  if (enr.loading || !enr.data) return null;

  const confirmed = enr.data.filter((e) => e.amount_paid > 0 && e.status !== "cancelled");
  if (confirmed.length === 0) return null;

  let collected = 0;
  let outstanding = 0;
  let overdueAmount = 0;
  let overdueStudents = 0;
  for (const e of confirmed) {
    const d = deriveCollections(e);
    collected += d.paid;
    outstanding += d.remaining;
    overdueAmount += d.overdueAmount;
    if (d.overdueAmount > 0) overdueStudents += 1;
  }

  return (
    <div className="mb-5 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><IndianRupee size={15} /></span>
          <div>
            <p className="text-sm font-semibold text-ink">Course fees &amp; EMI <span className="font-normal text-muted">· finance lens</span></p>
            <p className="text-[11px] text-muted">Cohort money &amp; seats live in Fees &amp; EMI — these numbers match it exactly.</p>
          </div>
        </div>
        <Link href="/admin/course-payments" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Open <ArrowRight size={13} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StripStat label="Course Fees Collected" value={formatINR(collected)} tone="text-success" title="Course-enrollment fees received. Excludes webinars & other products (see Total Receipts above)." />
        <StripStat label="Course Fees Outstanding" value={formatINR(outstanding)} tone={outstanding > 0 ? "text-warning" : undefined} title="Course fees still owed = total course fees − Course Fees Collected." />
        <StripStat label="Overdue" value={formatINR(overdueAmount)} tone={overdueAmount > 0 ? "text-danger" : undefined} sub={overdueStudents ? `${overdueStudents} student${overdueStudents === 1 ? "" : "s"}` : "none"} title="Past-due unpaid course-fee installments." />
        <Link href="/admin/course-payments/at-risk" className="rounded-xl bg-surface2 p-3 transition hover:bg-primary/5" title="Open the Fees at Risk (Collections) worklist">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Fees at Risk</p>
          <p className="mt-0.5 inline-flex items-center gap-1 font-heading text-lg font-extrabold text-primary">
            Review <ArrowRight size={15} />
          </p>
        </Link>
      </div>
    </div>
  );
}

function StripStat({ label, value, sub, tone, title }: { label: string; value: string; sub?: string; tone?: string; title?: string }) {
  return (
    <div className="rounded-xl bg-surface2 p-3" title={title}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 font-heading text-lg font-extrabold tabular-nums ${tone || ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
