/** Client-safe serialisable types for installment payment proofs. */
export type InstallmentProofStatus =
  | "pending"
  | "approved"
  | "approved_recorded"
  | "rejected"
  | "superseded";

export interface InstallmentProofFileMeta {
  path: string;
  mime: string;
  size: number;
  original_name: string;
}

export type InstallmentProofPromptState = "expiring" | "blocked" | "pending_review" | "none";

/** Plain props for the portal popup — no server imports. */
export interface InstallmentProofPromptProps {
  state: InstallmentProofPromptState;
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  installmentNo: number;
  amountDue: number;
  dueDate: string | null;
  /** Other unpaid dated instalments the student could be paying instead (includes the primary one). */
  unpaidInstallments?: Array<{ no: number; amount: number; due: string | null }>;
  /** Whole days left on live access (grant or grace). Null when blocked. */
  daysLeft: number | null;
  /** True when lectureAccessForCourse(..., override).allowed — never show blocked if true. */
  liveAccessAllowed: boolean;
  payHref: string;
  /** 0–100 display-only for the bar progress line. */
  pctPaid?: number | null;
  pendingProof: {
    id: string;
    submittedAt: string;
    filesCount: number;
    reviewReason: string | null;
  } | null;
}
