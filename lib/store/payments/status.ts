/**
 * Store payment status vocabulary and Eazypay Verify mapping.
 *
 * DELIBERATELY COPIED, NOT IMPORTED. The course path has its own status enum and
 * its own mapper in lib/eazypay.ts and lib/paymentOutcome/states.ts. Sharing a
 * helper between two money domains is exactly how a change made for courses
 * silently changes what "paid" means for the store — spec §4. The cost of this
 * decision is that an ICICI behaviour change must be applied in two places; that
 * cost is accepted and recorded here so the next reader knows it is on purpose.
 *
 * The status semantics below are ICICI's, per the Eazypay PG integration doc
 * (pp. 42–46), and match what the course path learned the hard way:
 *   Success                        → money settled to us
 *   RIP / SIP                      → money genuinely received, still settling
 *   Failed / Timeout / Cancelled / Expired / Returned / Rejected / Declined
 *                                  → ICICI reported a non-success terminal
 *   NotInitiated                   → never completed at the gateway
 *   anything else (Initiated, Challan Generated, In Clearance, unrecognised)
 *                                  → NOT a definitive answer; never change the row
 */

/** The store's own ledger statuses. Not the course enum. */
export type StorePaymentStatus =
  | "INITIATED"
  | "UNCONFIRMED"
  | "VERIFYING"
  | "CAPTURED"
  | "FAILED"
  | "EXPIRED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export const STORE_PAID_STATUSES: StorePaymentStatus[] = ["CAPTURED"];
export const STORE_OPEN_STATUSES: StorePaymentStatus[] = ["INITIATED", "UNCONFIRMED", "VERIFYING"];
export const STORE_TERMINAL_NONPAID: StorePaymentStatus[] = ["FAILED", "EXPIRED"];

export function isStorePaid(status: string | null | undefined): boolean {
  return String(status || "").toUpperCase() === "CAPTURED";
}

export function isStoreOpen(status: string | null | undefined): boolean {
  return STORE_OPEN_STATUSES.includes(String(status || "").toUpperCase() as StorePaymentStatus);
}

/** What a Verify call can conclude. */
export type StoreVerifyOutcome = "paid" | "failed" | "expired" | "unknown";

/** Whether money has reached our account yet. Recorded, never gating. */
export type StoreSettlement = "settled" | "in_progress";

/**
 * Map an EazyPGVerify `status` token to a store outcome.
 *
 * "unknown" is the fail-safe: the caller must leave the row untouched, because a
 * genuinely-paid customer must never be flipped to failed by an ambiguous or
 * unreachable response.
 */
export function mapStoreVerifyStatus(rawStatus: string | null | undefined): StoreVerifyOutcome {
  const s = (rawStatus || "").trim().toUpperCase();
  if (!s) return "unknown";

  // Money received: settled (Success) or settling (RIP / SIP).
  if (s === "SUCCESS" || s === "PAID" || s === "RIP" || s === "SIP") return "paid";

  // Never completed at the gateway — the customer never opened a payment
  // instrument. Punctuation-tolerant, and covers ICICI's known misspelling.
  const compact = s.replace(/[\s_-]+/g, "");
  if (compact === "NOTINITIATED" || compact === "NOTINITATED") return "expired";

  if (
    s === "FAILED" ||
    s === "FAILURE" ||
    s === "TIMEOUT" ||
    s.includes("EXPIRED") ||
    s.includes("RETURNED") ||
    s.includes("CANCEL") ||
    s.includes("REJECT") ||
    s.includes("DECLINE")
  ) {
    return "failed";
  }

  // Initiated / Challan Generated / In Clearance / anything unrecognised.
  return "unknown";
}

/** Settlement state implied by a status token. Only meaningful when paid. */
export function storeSettlementFor(rawStatus: string | null | undefined): StoreSettlement | null {
  const s = (rawStatus || "").trim().toUpperCase();
  if (s === "SUCCESS" || s === "PAID") return "settled";
  if (s === "RIP" || s === "SIP") return "in_progress";
  return null;
}

/**
 * Ledger status implied by a Verify outcome. Returning null means "do not write"
 * — the only correct response to an ambiguous or unreachable gateway.
 */
export function storeStatusForOutcome(outcome: StoreVerifyOutcome): StorePaymentStatus | null {
  switch (outcome) {
    case "paid":
      return "CAPTURED";
    case "failed":
      return "FAILED";
    case "expired":
      return "EXPIRED";
    default:
      return null;
  }
}

/**
 * Verify retry backoff, in minutes from creation. Mirrors the shape of the
 * course backstop (~2, 5, 10, 30, 60 minutes, then 6-hourly) without importing
 * it. A payment stops being chased after 3 days; by then EazyPGVerify has told
 * us NotInitiated or the order has been resolved by hand.
 */
const BACKOFF_MINUTES = [2, 5, 10, 30, 60, 180, 360, 720, 1080, 1440, 2160, 2880, 3600, 4320];

export function nextVerifyDelayMs(attempts: number): number | null {
  if (attempts >= BACKOFF_MINUTES.length) return null; // give up chasing
  return BACKOFF_MINUTES[Math.max(0, attempts)] * 60_000;
}
