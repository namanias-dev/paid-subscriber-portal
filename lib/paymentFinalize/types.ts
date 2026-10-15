import type { CourseEnrollment, PaymentReceipt } from "../types";

export type FinalizeOutcome =
  | "created"
  | "already_finalized"
  | "reconciled_existing"
  | "review_required"
  | "not_paid"
  | "not_found"
  | "no_enrollment"
  | "noop"
  | "insufficient_budget"
  | "error";

export type FinalizeCoursePaymentResult = {
  ok: boolean;
  outcome: FinalizeOutcome;
  enrollment: CourseEnrollment | null;
  receipt: PaymentReceipt | null;
  allocatedAmount?: number;
  error?: string;
};

export type DueFill = { no: number; due: string };
