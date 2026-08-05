"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCheck2, FileWarning } from "lucide-react";
import { formatINR, formatISTDateTime } from "@/lib/dates";
import type { InstallmentProofStatus } from "@/lib/installmentProofTypes";
import InstallmentProofReviewPanel from "@/components/admin/access/InstallmentProofReviewPanel";

interface ProofListItem {
  id: string;
  status: InstallmentProofStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_reason: string | null;
  installment_no: number;
  course_enrollment_id: string;
  claimed_amount: number | null;
  claimed_paid_date: string | null;
  reference_utr: string | null;
  student_comment: string | null;
  files: { path: string; original_name: string }[];
}

const STATUS_PILL: Record<InstallmentProofStatus, string> = {
  pending: "pill-amber",
  approved: "pill-green",
  approved_recorded: "pill-green",
  rejected: "pill-red",
  superseded: "pill-gray",
};

const STATUS_LABEL: Record<InstallmentProofStatus, string> = {
  pending: "Pending review",
  approved: "Approved (access only)",
  approved_recorded: "Approved & recorded",
  rejected: "Rejected",
  superseded: "Superseded",
};

export default function InstallmentProofsSection({
  phone,
  studentName,
  pctPaid,
  amountPaid,
  totalFee,
  amountDue,
}: {
  phone: string;
  studentName: string;
  pctPaid: number;
  amountPaid: number;
  totalFee: number;
  amountDue: number;
}) {
  const [proofs, setProofs] = useState<ProofListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/installment-proofs?phone=${encodeURIComponent(phone)}`);
      const json = await res.json();
      if (res.ok && json.ok) {
        setProofs((json.proofs || []) as ProofListItem[]);
      } else {
        setProofs([]);
      }
    } catch {
      setProofs([]);
    } finally {
      setLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted">Loading payment proofs…</p>;
  }

  if (proofs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
        No installment payment proofs uploaded yet.
      </p>
    );
  }

  const pendingCount = proofs.filter((p) => p.status === "pending").length;

  return (
    <>
      {pendingCount > 0 && (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
          <FileWarning size={13} />
          {pendingCount} proof{pendingCount === 1 ? "" : "s"} awaiting review
        </p>
      )}

      <ul className="space-y-3">
        {proofs.map((p) => (
          <li key={p.id} className="rounded-xl border border-line p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`pill ${STATUS_PILL[p.status]} text-[10px]`}>{STATUS_LABEL[p.status]}</span>
                  <span className="text-xs text-muted">Inst #{p.installment_no}</span>
                  <span className="text-xs text-muted">· {p.files.length} file{p.files.length === 1 ? "" : "s"}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Submitted {formatISTDateTime(p.submitted_at)}
                  {p.reviewed_at ? ` · Reviewed ${formatISTDateTime(p.reviewed_at)}` : ""}
                </p>
              </div>
              {p.status === "pending" && (
                <button
                  type="button"
                  onClick={() => setReviewId(p.id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <FileCheck2 size={13} /> Review
                </button>
              )}
            </div>

            <dl className="mt-2.5 grid gap-1.5 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted">Claimed amount</dt>
                <dd className="font-medium">{p.claimed_amount != null ? formatINR(p.claimed_amount) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Claimed date</dt>
                <dd className="font-medium">{p.claimed_paid_date || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">UTR / reference</dt>
                <dd className="font-mono font-medium">{p.reference_utr || "—"}</dd>
              </div>
              {p.student_comment && (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Comment</dt>
                  <dd className="whitespace-pre-wrap">{p.student_comment}</dd>
                </div>
              )}
              {p.reviewed_by && (
                <div>
                  <dt className="text-muted">Reviewer</dt>
                  <dd>{p.reviewed_by}</dd>
                </div>
              )}
              {p.review_reason && (
                <div className="sm:col-span-2">
                  <dt className="text-muted">Review note</dt>
                  <dd>{p.review_reason}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>

      {reviewId && (
        <InstallmentProofReviewPanel
          proofId={reviewId}
          student={studentName}
          pctPaid={pctPaid}
          amountPaid={amountPaid}
          totalFee={totalFee}
          amountDue={amountDue}
          onClose={() => setReviewId(null)}
          onUpdated={() => {
            setReviewId(null);
            void load();
          }}
        />
      )}
    </>
  );
}
