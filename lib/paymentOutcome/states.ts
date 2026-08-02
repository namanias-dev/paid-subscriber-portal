/**
 * Payment outcome state machine (gateway learning only — never amounts/schedules).
 *
 *   INITIATED → UNCONFIRMED → PAID | FAILED | EXPIRED
 *
 * Callback is advisory (→ UNCONFIRMED). Only ICICI Verify may write a terminal.
 * PAID is immutable (DB trigger + conditional writes).
 */
import type { PaymentStatus } from "../types";

export const PAID_STATUSES = ["PAID", "captured"] as const;

/** Open / non-terminal — Verify may still run. */
export const OPEN_STATUSES = [
  "INITIATED",
  "UNCONFIRMED",
  "PENDING",
  "pending",
  "VERIFYING",
] as const;

/** Terminal non-paid. Still upgradeable to PAID if Verify later says success (RIP). */
export const TERMINAL_NONPAID = ["FAILED", "EXPIRED", "ABANDONED"] as const;

/** All statuses Verify may transition FROM into PAID. */
export const NON_PAID_STATUSES = [...OPEN_STATUSES, ...TERMINAL_NONPAID] as const;

export type TerminalStatus = "PAID" | "FAILED" | "EXPIRED";

export function isPaidStatus(s: string | null | undefined): boolean {
  const u = (s || "").toUpperCase();
  return u === "PAID" || u === "CAPTURED";
}

export function isTerminalNonPaid(s: string | null | undefined): boolean {
  const u = (s || "").toUpperCase();
  return u === "FAILED" || u === "EXPIRED" || u === "ABANDONED";
}

export function isOpenPaymentStatus(s: string | null | undefined): boolean {
  const u = (s || "").toUpperCase();
  return (
    u === "INITIATED" ||
    u === "UNCONFIRMED" ||
    u === "PENDING" ||
    u === "VERIFYING"
  );
}

/** Statuses eligible for Verify / ladder (everything except PAID). */
export function isVerifyEligible(s: string | null | undefined): boolean {
  return !isPaidStatus(s);
}

export function asPaymentStatus(s: string): PaymentStatus {
  return s as PaymentStatus;
}
