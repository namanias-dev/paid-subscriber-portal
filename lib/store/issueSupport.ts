/**
 * Notes Store customer-service helpers.
 *
 * Rules:
 * - `customer_note` is the staff personal reply. Never overwritten by customer
 *   follow-ups or automatic milestone copy.
 * - `milestone_note` is a short verified courier update for the tracking page.
 * - `awaiting_staff_reply` surfaces unanswered customer messages in the CS queue.
 */
import { clampIssueText, issueIsOpen, OPEN_ISSUE_STATUSES } from "./issues";

export const SHIPMENT_EXCEPTION_STATUSES = new Set([
  "delivery_failed",
  "ndr",
  "rto",
  "cancelled",
  "lost",
  "damaged",
]);

export type MilestoneMappedStatus =
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_failed"
  | string;

/** Preserve line breaks in staff/customer-facing support notes. */
export function clampSupportNote(value: string, max = 800): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export function issueAnswered(row: {
  last_staff_reply_at?: string | null;
  last_customer_message_at?: string | null;
  awaiting_staff_reply?: boolean | null;
}): boolean {
  if (row.awaiting_staff_reply) return false;
  if (!row.last_staff_reply_at) return false;
  if (!row.last_customer_message_at) return true;
  return new Date(row.last_staff_reply_at).getTime() >= new Date(row.last_customer_message_at).getTime();
}

export function issueNeedsAttention(row: {
  status: string;
  awaiting_staff_reply?: boolean | null;
  last_staff_reply_at?: string | null;
  priority?: string | null;
  shipment_status?: string | null;
  order_status?: string | null;
}): boolean {
  if (!issueIsOpen(row.status)) return false;
  if (row.awaiting_staff_reply) return true;
  if (!row.last_staff_reply_at && row.status === "OPEN") return true;
  if (row.priority === "high") return true;
  if (row.shipment_status && SHIPMENT_EXCEPTION_STATUSES.has(row.shipment_status)) return true;
  if (row.order_status === "DELIVERY_FAILED" || row.order_status === "PAYMENT_FAILED") return true;
  return false;
}

export function supportPriorityRank(row: {
  priority?: string | null;
  awaiting_staff_reply?: boolean | null;
  status?: string | null;
  shipment_status?: string | null;
  order_status?: string | null;
  created_at?: string | null;
}): number {
  let rank = 0;
  if (row.priority === "high") rank += 100;
  if (row.awaiting_staff_reply) rank += 80;
  if (row.status === "OPEN" && !row.awaiting_staff_reply) rank += 40;
  if (row.shipment_status && SHIPMENT_EXCEPTION_STATUSES.has(row.shipment_status)) rank += 70;
  if (row.order_status === "PAYMENT_FAILED") rank += 90;
  if (row.created_at) {
    const hours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
    if (hours > 72) rank += 30;
    else if (hours > 48) rank += 20;
    else if (hours > 24) rank += 10;
  }
  return rank;
}

/** Short verified milestone copy. No ETA unless caller supplies a confirmed date. */
export function buildMilestoneNote(input: {
  mappedStatus: MilestoneMappedStatus;
  courier?: string | null;
  awb?: string | null;
  location?: string | null;
  etaDate?: string | null;
}): string | null {
  const courier = (input.courier || "").trim();
  const awb = (input.awb || "").trim();
  const location = (input.location || "").trim();
  const status = (input.mappedStatus || "").toLowerCase();
  const track = awb ? ` Tracking ID: ${awb}.` : "";
  const via = courier ? ` via ${courier}` : "";
  const at = location ? ` (${location})` : "";

  if (status === "picked_up") {
    return clampSupportNote(`Your notes have been picked up${via}.${track} We're monitoring the delivery.`);
  }
  if (status === "in_transit") {
    return clampSupportNote(`Your notes are in transit${via}${at}.${track} We'll share further updates as scans come in.`);
  }
  if (status === "out_for_delivery") {
    return clampSupportNote(`Your notes are out for delivery${via}${at}.${track}`);
  }
  if (status === "delivered") {
    return clampSupportNote(`Your notes have been delivered${via}${at}.${track}`);
  }
  if (status === "delivery_failed" || status === "ndr") {
    return clampSupportNote(
      `The courier reported a delivery attempt issue${at}. Our team is reviewing this and will update you here.${track}`,
    );
  }
  return null;
}

export type IssueSupportPatch = {
  milestone_note?: string;
  last_customer_message_at?: string;
  last_staff_reply_at?: string;
  awaiting_staff_reply?: boolean;
  priority?: string;
  updated_at?: string;
};

/** Staff reply patch — writes customer_note ownership timestamps; never clears history. */
export function staffReplyPatch(now: string, hasCustomerNote: boolean): IssueSupportPatch {
  const patch: IssueSupportPatch = { updated_at: now };
  if (hasCustomerNote) {
    patch.last_staff_reply_at = now;
    patch.awaiting_staff_reply = false;
  }
  return patch;
}

/** Customer follow-up patch — must not include customer_note. */
export function customerFollowUpPatch(now: string): IssueSupportPatch {
  return {
    last_customer_message_at: now,
    awaiting_staff_reply: true,
    updated_at: now,
  };
}

export function milestoneIssuePatch(
  note: string,
  now: string,
  opts?: { exception?: boolean },
): IssueSupportPatch {
  const patch: IssueSupportPatch = {
    milestone_note: clampSupportNote(note),
    updated_at: now,
  };
  if (opts?.exception) {
    patch.priority = "high";
    patch.awaiting_staff_reply = true;
  }
  return patch;
}

export { OPEN_ISSUE_STATUSES, clampIssueText };
