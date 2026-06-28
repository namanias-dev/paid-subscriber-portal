"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DuplicateEnrollmentGroup } from "@/lib/types";

/**
 * Super-admin-only dashboard alert. Detects duplicate active enrollments on demand
 * (query-based, no cron). Renders nothing for non-super admins (403) or when clean,
 * so the badge clears automatically once duplicates are merged.
 */
export default function DuplicateEnrollmentAlert() {
  const [groups, setGroups] = useState<DuplicateEnrollmentGroup[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/enrollments/duplicates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.ok) setGroups(d.groups as DuplicateEnrollmentGroup[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!groups || groups.length === 0) return null;
  const extra = groups.reduce((sum, g) => sum + (g.count - 1), 0);

  return (
    <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-red-600 text-sm font-bold text-white">{groups.length}</span>
          <div>
            <p className="font-semibold text-red-800">
              Duplicate enrollments detected — {groups.length} student{groups.length > 1 ? "s" : ""} with repeated bookings ({extra} extra)
            </p>
            <p className="text-sm text-red-700">Same phone + course booked more than once. Merge to fix inflated balances.</p>
          </div>
        </div>
        <Link href="/admin/enrollments/duplicates" className="btn btn-primary text-sm">Review &amp; merge →</Link>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {groups.slice(0, 6).map((g) => (
          <li key={`${g.phone}|${g.course_id}`} className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs text-red-800">
            {g.student_name || g.phone} · {g.course_title} · <b>{g.count}×</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
