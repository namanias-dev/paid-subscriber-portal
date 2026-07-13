"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldOff, UserRound } from "lucide-react";
import { LoadingBlock } from "@/components/admin/ui";
import OverallPerformance from "@/components/dashboard/OverallPerformance";

/**
 * Faculty/admin per-student Overall Performance view. Reuses the SAME dashboard
 * component + aggregation as the student-front tab, keyed strictly by student id.
 * The feeding endpoint is role-gated server-side; this page adds a client-side
 * permission check for a clean access-denied UX. Read-only.
 *
 * Context-aware navigation: when reached FROM the Performance Leaderboard
 * (?from=leaderboard, carrying the board's batch/quiz scope), "Back" returns to
 * the leaderboard WITH those filters restored; otherwise it returns to the
 * student profile. A separate "View Student Profile" action always opens the full
 * Students & Enrollments profile. The batch/quiz scope is forwarded to the
 * endpoint so the faculty comparison matches exactly what the board showed.
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

  // Read navigation context from the URL once (client-only — avoids a Suspense
  // boundary and a double fetch). `from` marks the origin; `batchScope`/`quizId`
  // carry the leaderboard's active filters.
  const nav = useMemo(() => {
    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return {
      from: sp.get("from") || "",
      batchScope: sp.get("batchScope") || "",
      quizId: sp.get("quizId") || "",
    };
  }, []);

  const fromLeaderboard = nav.from === "leaderboard";

  const backHref = useMemo(() => {
    if (!fromLeaderboard) return `/admin/students/${params.id}`;
    const p = new URLSearchParams();
    if (nav.batchScope && nav.batchScope !== "all") p.set("batch", nav.batchScope);
    if (nav.quizId) p.set("quizId", nav.quizId);
    const qs = p.toString();
    return `/admin/leaderboard${qs ? `?${qs}` : ""}`;
  }, [fromLeaderboard, nav, params.id]);

  const endpoint = useMemo(() => {
    const p = new URLSearchParams({ studentId: params.id });
    if (nav.batchScope) p.set("batchScope", nav.batchScope);
    if (nav.quizId) p.set("quizId", nav.quizId);
    return `/api/admin/quiz-performance/overall?${p.toString()}`;
  }, [params.id, nav]);

  return (
    <div className="space-y-5 pb-16">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft size={15} /> {fromLeaderboard ? "Back to Leaderboard" : "Back to student profile"}
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
          endpoint={endpoint}
          enablePdfExport
          variant="faculty"
          headerActions={
            <Link
              href={`/admin/students/${params.id}`}
              className="ca-focus inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink2 transition hover:text-ink"
            >
              <UserRound size={13} aria-hidden="true" /> View Student Profile
            </Link>
          }
        />
      )}
    </div>
  );
}
