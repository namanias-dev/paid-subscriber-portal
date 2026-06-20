"use client";

import { useDashboard } from "@/components/dashboard/DashboardContext";
import ExpiredView from "@/components/dashboard/ExpiredView";
import EmptyState from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatINR, formatDate } from "@/lib/dates";

export default function FeesPage() {
  const { loading, expired, student, enrollments, courses } = useDashboard();
  const { toast } = useToast();

  if (loading) return <CardSkeleton />;
  if (expired) return <ExpiredView student={student} />;

  const totalPending = enrollments.reduce((a, e) => a + (e.pending || 0), 0);
  const totalPaid = enrollments.reduce((a, e) => a + (e.fee_collected || 0), 0);

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl">My Fees</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-5">
          <p className="text-xs text-muted">Total paid</p>
          <p className="font-heading text-2xl text-success">{formatINR(totalPaid)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-muted">Pending balance</p>
          <p className="font-heading text-2xl text-warning">{formatINR(totalPending)}</p>
        </div>
      </div>

      {enrollments.length === 0 ? (
        <EmptyState icon="💳" title="No fee records" subtitle="Your enrolled course fees will show up here." />
      ) : (
        enrollments.map((e) => {
          const course = courses.find((c) => c.id === e.course_id);
          return (
            <div key={e.id} className="card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base">{course?.title || "Course"}</h3>
                <span className="text-sm text-ink2">{formatINR(e.fee_total)}</span>
              </div>
              <div className="mt-4 space-y-2">
                {e.installments.map((inst, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{inst.label}</p>
                      <p className="text-xs text-muted">Due {formatDate(inst.due)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span>{formatINR(inst.amount)}</span>
                      {inst.paid ? (
                        <span className="pill pill-green">Paid</span>
                      ) : (
                        <button
                          onClick={() => toast("Demo mode — connect Razorpay to enable payments", "info")}
                          className="btn btn-primary px-3 py-1.5 text-xs"
                        >
                          Pay now
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
