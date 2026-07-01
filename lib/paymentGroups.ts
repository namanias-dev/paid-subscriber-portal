import type { Payment, PaymentProofStatus } from "./types";
import { isPaidStatus, itemKey } from "./paymentsAgg";

/**
 * ============================================================================
 *  PAYMENT GROUPS — canonical, paid-wins group status (PURE helpers).
 *
 *  A "group" is the SAME real-world obligation: one student paying for one
 *  item for one purpose. We reuse the exact grouping key the duplicate-
 *  enrollment / attempts-vs-enrollment work already uses:
 *
 *      phone  +  item_type  +  item (slug/title)  +  purpose
 *
 *  purpose distinguishes seat-booking vs full-fee vs a specific installment,
 *  so a paid seat-booking and a verifying full-fee NEVER merge into one group.
 *  Amount is deliberately NOT part of the key (a ₹1 vs ₹5000 attempt for the
 *  same obligation is still the same obligation).
 *
 *  The canonical group status is DERIVED here (never stored-and-drifting), so
 *  it self-corrects the moment a late gateway callback or a manual approval
 *  flips one attempt to PAID. PAID/approved always wins over any unpaid attempt
 *  in the group.
 *
 *  This module is PURE (no Supabase / no server deps) so it is safe to import
 *  from client components. The write-side (auto-supersede, backfill) lives in
 *  lib/paymentSupersede.ts.
 * ============================================================================
 */

export type GroupStatus = "paid" | "verifying" | "pending" | "initiated" | "abandoned" | "failed" | "refunded" | "unknown";

/** seat-booking vs full-fee vs a specific installment — never merge across these. */
export function purposeOf(p: Payment): string {
  if (p.payment_kind === "seat") return "seat";
  if (p.payment_kind === "installment") return `inst:${p.installment_no ?? 0}`;
  return "full"; // one_time / full / null all settle the same (full) obligation
}

/** Stable canonical group key shared with the duplicate-enrollment work. */
export function groupKeyOf(p: Payment): string {
  return [(p.phone || "").trim(), p.item_type, itemKey(p), purposeOf(p)].join("|");
}

/** A short, human label for the purpose (UI chip). */
export function purposeLabel(p: Payment): string {
  if (p.payment_kind === "seat") return "Seat booking";
  if (p.payment_kind === "installment") return `Installment #${p.installment_no ?? "?"}`;
  return "Full payment";
}

const isRefunded = (s: Payment["status"]) => s === "refunded";
const isVerifying = (s: Payment["status"]) => s === "VERIFYING";
const isPending = (s: Payment["status"]) => s === "PENDING" || s === "pending";
const isInitiated = (s: Payment["status"]) => s === "INITIATED";
const isAbandoned = (s: Payment["status"]) => s === "ABANDONED";
const isFailed = (s: Payment["status"]) => s === "FAILED";

/** Proof states that mean "uploaded, awaiting/holding a decision". */
const PROOF_OPEN: PaymentProofStatus[] = ["submitted", "reupload_requested"];

/**
 * Canonical group status with PAID/APPROVED winning over everything. Optionally
 * factor in proof state (an accepted proof counts as approved; an open proof
 * counts as verifying) — pass a payment_id -> proof status map if available.
 */
export function deriveGroupStatus(
  attempts: Payment[],
  proofStatusByPayment?: Record<string, PaymentProofStatus | undefined>,
): GroupStatus {
  if (!attempts.length) return "unknown";
  const proofOf = (id: string) => proofStatusByPayment?.[id];

  const anyPaid = attempts.some((p) => isPaidStatus(p.status) || proofOf(p.id) === "accepted");
  if (anyPaid) return "paid";

  const anyVerifying = attempts.some(
    (p) => isVerifying(p.status) || PROOF_OPEN.includes(proofOf(p.id) as PaymentProofStatus),
  );
  if (anyVerifying) return "verifying";

  if (attempts.some((p) => isPending(p.status))) return "pending";
  // A live checkout that was opened but never confirmed. Not actionable by staff
  // (no money in flight) and never a false "needs verification".
  if (attempts.some((p) => isInitiated(p.status))) return "initiated";
  if (attempts.some((p) => isAbandoned(p.status))) return "abandoned";
  if (attempts.some((p) => isFailed(p.status))) return "failed";
  if (attempts.every((p) => isRefunded(p.status))) return "refunded";
  return "unknown";
}

/** Paid rows in a group (real money received). */
export function paidAttempts(attempts: Payment[]): Payment[] {
  return attempts.filter((p) => isPaidStatus(p.status));
}

/**
 * Two or more SETTLED payments for the same obligation = possible duplicate
 * payment → flag for human refund review (never auto-supersede a paid row).
 */
export function hasDuplicatePaid(attempts: Payment[]): boolean {
  return paidAttempts(attempts).length >= 2;
}

/**
 * A group "needs action" only when there is NO paid/approved attempt AND its
 * canonical state is something a human must move forward (verifying/pending).
 * A paid group can therefore NEVER appear in needs-verification lists.
 */
export function groupNeedsAction(status: GroupStatus): boolean {
  return status === "verifying" || status === "pending";
}

export interface PaymentGroup {
  key: string;
  attempts: Payment[]; // newest-first
  status: GroupStatus;
  /** Unpaid attempts flagged superseded by a paid/approved sibling. */
  supersededIds: Set<string>;
  /** The paid record that grants access (earliest paid), if any. */
  paidAnchor: Payment | null;
  /** Representative attempt for "Manage" (paid anchor, else newest open). */
  primary: Payment;
  duplicatePaid: boolean;
  needsAction: boolean;
  /** Amount to show: deduped paid total if paid, else the obligation amount. */
  amount: number;
  latestAt: number;
}

/** Build canonical groups (with derived status + supersession) from raw rows. */
export function buildPaymentGroups(
  rows: Payment[],
  proofStatusByPayment?: Record<string, PaymentProofStatus | undefined>,
): PaymentGroup[] {
  const byKey = new Map<string, Payment[]>();
  for (const p of rows) {
    const k = groupKeyOf(p);
    const arr = byKey.get(k);
    if (arr) arr.push(p);
    else byKey.set(k, [p]);
  }

  const groups: PaymentGroup[] = [];
  for (const [key, list] of byKey) {
    const attempts = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const status = deriveGroupStatus(attempts, proofStatusByPayment);
    const paid = paidAttempts(attempts);
    const paidAnchor =
      paid.length > 0
        ? [...paid].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
        : null;
    const supersededIds = new Set(attempts.filter((p) => p.is_superseded).map((p) => p.id));
    const openNewest = attempts.find((p) => !p.is_superseded) || attempts[0];
    const primary = paidAnchor || openNewest;
    const duplicatePaid = paid.length >= 2;
    const needsAction = groupNeedsAction(status);
    // Deduped paid total for paid groups; for unpaid groups show the largest
    // (full) obligation among open attempts so staff see what is owed, not a sum
    // of retries.
    let amount: number;
    if (paid.length) {
      const seen = new Map<number, number>();
      for (const p of paid) seen.set(p.amount, (seen.get(p.amount) || 0) + 1);
      // collapse exact retry-duplicates: count each distinct amount once
      amount = [...seen.keys()].reduce((a, v) => a + v, 0);
    } else {
      amount = attempts.reduce((m, p) => Math.max(m, p.amount), 0);
    }
    const latestAt = new Date(attempts[0].created_at).getTime();
    groups.push({ key, attempts, status, supersededIds, paidAnchor, primary, duplicatePaid, needsAction, amount, latestAt });
  }
  return groups;
}

/** UI metadata for a canonical group status. */
export const GROUP_STATUS_META: Record<GroupStatus, { label: string; pill: string; dot: string }> = {
  paid: { label: "Paid", pill: "pill-green", dot: "bg-success" },
  verifying: { label: "Verifying", pill: "pill-blue", dot: "bg-blue-500" },
  pending: { label: "Pending", pill: "pill-amber", dot: "bg-amber-500" },
  initiated: { label: "Checkout opened", pill: "pill-gray", dot: "bg-slate-400" },
  abandoned: { label: "Abandoned", pill: "pill-saffron", dot: "bg-orange-500" },
  failed: { label: "Failed", pill: "pill-red", dot: "bg-danger" },
  refunded: { label: "Refunded", pill: "pill-gray", dot: "bg-ink2" },
  unknown: { label: "—", pill: "pill-gray", dot: "bg-ink2" },
};
