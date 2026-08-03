"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/admin/ui";
import { formatINR, formatISTDate } from "@/lib/dates";

type Row = {
  enrollmentId: string;
  phone: string;
  studentName: string | null;
  courseId: string;
  courseTitle: string;
  batchId: string | null;
  batchLabel: string | null;
  status: string;
  amountPaid: number;
  createdAt: string;
  reason: string;
};

export default function AmbiguousBatchesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/enrollments/ambiguous-batches");
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          if (!cancelled) setError(data?.error || "Failed to load");
          return;
        }
        if (!cancelled) setRows(data.rows || []);
      } catch {
        if (!cancelled) setError("Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function downloadCsv() {
    if (!rows?.length) return;
    const header = ["enrollment_id", "phone", "student_name", "course_title", "batch_id", "batch_label", "status", "amount_paid", "reason", "created_at"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.enrollmentId,
          r.phone,
          JSON.stringify(r.studentName || ""),
          JSON.stringify(r.courseTitle),
          JSON.stringify(r.batchId || ""),
          JSON.stringify(r.batchLabel || ""),
          r.status,
          r.amountPaid,
          r.reason,
          r.createdAt,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ambiguous-batch-enrolments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Enrolments missing batch</h1>
          <p className="mt-1 text-sm text-muted">
            Paid enrolments on multi-batch courses with no resolvable batch. Content access fail-opens for these until corrected.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/students" className="btn btn-ghost text-sm">Students</Link>
          <button type="button" className="btn btn-primary text-sm" onClick={downloadCsv} disabled={!rows?.length}>
            Export CSV
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {rows === null && !error ? (
        <LoadingBlock />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="min-w-full text-sm">
            <thead className="bg-surface2 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Course</th>
                <th className="px-3 py-2">Stored batch</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Paid</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Enrolled</th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.enrollmentId} className="border-t border-line">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.studentName || "—"}</div>
                    <div className="font-mono text-xs text-muted">{r.phone}</div>
                  </td>
                  <td className="px-3 py-2">{r.courseTitle}</td>
                  <td className="px-3 py-2 text-xs">
                    <div>{r.batchLabel || "—"}</div>
                    <div className="font-mono text-muted">{r.batchId || "null"}</div>
                  </td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">{formatINR(r.amountPaid)}</td>
                  <td className="px-3 py-2 text-xs">{r.reason}</td>
                  <td className="px-3 py-2 text-xs">{formatISTDate(r.createdAt)}</td>
                </tr>
              ))}
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">No ambiguous enrolments.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
