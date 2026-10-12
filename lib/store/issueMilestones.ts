import type { storeDb } from "./db";
import { OPEN_ISSUE_STATUSES } from "./issues";
import {
  buildMilestoneNote,
  isShipmentException,
  milestoneIssuePatch,
  normalizeStatusToken,
  shouldReplaceMilestone,
} from "./issueSupport";

type StoreDb = NonNullable<ReturnType<typeof storeDb>>;

function statusHintFromNote(note: string | null | undefined): string | null {
  const text = (note || "").toLowerCase();
  if (!text) return null;
  if (text.includes("delivered")) return "delivered";
  if (text.includes("out for delivery")) return "out_for_delivery";
  if (text.includes("in transit")) return "in_transit";
  if (text.includes("picked up")) return "picked_up";
  if (text.includes("delivery attempt issue")) return "delivery_failed";
  return null;
}

/**
 * Write a short verified milestone onto open issues for an order.
 * Never touches staff `customer_note`.
 *
 * Idempotent for identical notes, rejects stale/out-of-order milestones, and
 * skips event inserts when nothing changed.
 */
export async function applyCourierMilestoneToOpenIssues(
  db: StoreDb,
  orderId: string,
  input: {
    mappedStatus: string;
    courier?: string | null;
    awb?: string | null;
    location?: string | null;
  },
): Promise<{ updated: number; note: string | null; skipped: number }> {
  try {
    const note = buildMilestoneNote(input);
    if (!note) return { updated: 0, note: null, skipped: 0 };

    const { data: issues, error: readError } = await db
      .from("store_order_issues")
      .select("id,status,milestone_note")
      .eq("order_id", orderId)
      .in("status", [...OPEN_ISSUE_STATUSES]);
    if (readError || !issues?.length) return { updated: 0, note, skipped: 0 };

    const now = new Date().toISOString();
    const exception = isShipmentException(input.mappedStatus);
    const nextStatus = normalizeStatusToken(input.mappedStatus);
    let updated = 0;
    let skipped = 0;

    for (const row of issues) {
      const replace = shouldReplaceMilestone(
        row.milestone_note,
        statusHintFromNote(row.milestone_note),
        nextStatus,
        note,
      );
      if (!replace) {
        skipped += 1;
        continue;
      }

      const patch = milestoneIssuePatch(note, now, { exception });
      const { error } = await db.from("store_order_issues").update(patch).eq("id", row.id);
      if (error) {
        skipped += 1;
        continue;
      }

      await db.from("store_order_issue_events").insert({
        issue_id: row.id,
        order_id: orderId,
        event: "milestone",
        from_status: row.status,
        to_status: row.status,
        actor_type: "system",
        actor_name: "courier",
        body: note,
        visibility: "customer",
        created_at: now,
      });
      updated += 1;
    }

    return { updated, note, skipped };
  } catch {
    // Webhook must not fail because CS milestone bookkeeping failed.
    return { updated: 0, note: null, skipped: 0 };
  }
}
