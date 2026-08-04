/** Client-safe serialisable types for installment payment proofs. */
export type InstallmentProofStatus = "pending" | "approved" | "rejected" | "superseded";

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
  /** Whole days left on live access (grant or grace). Null when blocked. */
  daysLeft: number | null;
  /** True when lectureAccessForCourse(..., override).allowed — never show blocked if true. */
  liveAccessAllowed: boolean;
  payHref: string;
  pendingProof: {
    id: string;
    submittedAt: string;
    filesCount: number;
    reviewReason: string | null;
  } | null;
}
