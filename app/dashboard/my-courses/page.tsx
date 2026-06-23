"use client";

import Link from "next/link";
import { useDashboard } from "@/components/dashboard/DashboardContext";
import ExpiredView from "@/components/dashboard/ExpiredView";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { formatINR } from "@/lib/dates";

export default function MyCoursesPage() {
  const { loading, expired, student, enrollments, courses } = useDashboard();

  if (loading)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  if (expired) return <ExpiredView student={student} />;

  const items = enrollments.map((e) => ({ e, course: courses.find((c) => c.id === e.course_id) }));

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl">My Courses</h1>
      {items.length === 0 ? (
        <EmptyState icon="🎓" title="No enrolled courses yet" subtitle="Browse our catalogue and enroll to start learning." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map(({ e, course }) => (
            <div key={e.id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg leading-snug">{course?.title || "Course"}</h3>
                <span className="pill pill-blue">{course?.category}</span>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs text-muted">
                  <span>Progress</span>
                  <span>{e.progress}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-surface">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${e.progress}%` }} />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-ink2">
                  {e.pending > 0 ? (
                    <span className="text-warning">Pending: {formatINR(e.pending)}</span>
                  ) : (
                    <span className="text-success">Fully paid ✓</span>
                  )}
                </span>
                <span className={`pill ${e.status === "active" ? "pill-green" : "pill-gray"}`}>{e.status}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {course && e.status === "active" && (
                  <Link href={`/dashboard/class/${course.id}`} className="btn btn-primary flex-1 text-sm">Class Hub →</Link>
                )}
                <Link href="/dashboard/live" className="btn btn-secondary text-sm">Library</Link>
                {e.pending > 0 && <Link href="/dashboard/fees" className="btn btn-secondary text-sm">Pay fees</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
