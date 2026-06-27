import type { Payment } from "./types";

/** A payment that represents real money received (Razorpay "captured" or ICICI "PAID"). */
export const isPaidStatus = (s: Payment["status"]): boolean => s === "captured" || s === "PAID";

/** Stable per-item key: prefer the slug, fall back to the title (case-insensitive). */
export function itemKey(p: Payment): string {
  return (p.item_slug || p.item || "").trim().toLowerCase();
}

/**
 * Collapse RETRY-DUPLICATE paid rows so finance/seat metrics aren't inflated when
 * one person ends up with multiple IDENTICAL paid rows for a single purchase
 * (e.g. they clicked Pay twice and both ICICI references settled). Two rows are
 * treated as the SAME money ONLY when phone + item + payment_kind + installment_no
 * + amount all match, so legitimately-distinct rows are NEVER merged:
 *   • course installments differ by installment_no
 *   • a "book seat" payment + a "full" payment differ by payment_kind (and amount)
 *   • different items / people obviously differ
 * Returns a new array with one row per distinct key (keeping the earliest row).
 * Pass an already paid-filtered list.
 */
export function dedupePaidRows(paidRows: Payment[]): Payment[] {
  const seen = new Map<string, Payment>();
  for (const p of paidRows) {
    const key = [
      (p.phone || "").trim(),
      itemKey(p),
      p.payment_kind || "",
      p.installment_no ?? "",
      p.amount,
    ].join("|");
    const prev = seen.get(key);
    if (!prev || new Date(p.created_at).getTime() < new Date(prev.created_at).getTime()) {
      seen.set(key, p);
    }
  }
  return [...seen.values()];
}

/** Sum of paid amounts AFTER collapsing retry-duplicate rows. */
export function dedupedPaidTotal(paidRows: Payment[]): number {
  return dedupePaidRows(paidRows).reduce((a, p) => a + p.amount, 0);
}

/**
 * Count of distinct REGISTRATIONS (one seat per person per item) among the given
 * paid rows — i.e. distinct (phone, item). Two paid rows for the same person+item
 * (retry edge) count once; the same person registering for two DIFFERENT items
 * counts twice.
 */
export function distinctRegistrations(paidRows: Payment[]): number {
  const set = new Set<string>();
  for (const p of paidRows) set.add(`${(p.phone || "").trim()}|${itemKey(p)}`);
  return set.size;
}
