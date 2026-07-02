"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldOff } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import OverallPerformance from "@/components/dashboard/OverallPerformance";

/**
 * Faculty/admin per-student Overall Performance view. Reuses the SAME dashboard
 * component + aggregation as the student-front tab, keyed strictly by student id
 * (Feature-3 profile route). The feeding endpoint is role-gated server-side; this
 * page adds a client-side permission check for a clean access-denied UX. Read-only.
 */
export default function AdminStudentPerformancePage({ params }: { params: { id: string } }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => {
        const perms = d?.admin?.permissions;
        setAllowed(!!d?.ok && perms?.manage_students_leads === true);
      })
      .catch(() => setAllowed(false));
  }, []);

  return (
    <div className="space-y-5 pb-16">
      <Link href={`/admin/students/${params.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft size={15} /> Back to student profile
      </Link>

      {allowed === null ? (
        <div className="space-y-4"><LoadingBlock /><LoadingBlock /></div>
      ) : !allowed ? (
        <div className="card flex flex-col items-center p-10 text-center">
          <ShieldOff size={26} className="mb-3 text-danger" aria-hidden="true" />
          <p className="font-heading text-lg font-bold">You don&apos;t have access to student performance</p>
          <p className="mt-1 text-sm text-ink2">This view requires the &ldquo;Manage students, leads &amp; enrollments&rdquo; permission.</p>
        </div>
      ) : (
        <OverallPerformance
          endpoint={`/api/admin/quiz-performance/overall?studentId=${encodeURIComponent(params.id)}`}
          enablePdfExport
        />
      )}
    </div>
  );
}
