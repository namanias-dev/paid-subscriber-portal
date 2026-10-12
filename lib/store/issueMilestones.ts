import type { storeDb } from "./db";
import { OPEN_ISSUE_STATUSES } from "./issues";
import { buildMilestoneNote, milestoneIssuePatch, SHIPMENT_EXCEPTION_STATUSES } from "./issueSupport";

type StoreDb = NonNullable<ReturnType<typeof storeDb>>;

/**
 * Write a short verified milestone onto open issues for an order.
 * Never touches staff `customer_note`. Exceptions mark awaiting_staff_reply.
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
): Promise<{ updated: number; note: string | null }> {
  const note = buildMilestoneNote(input);
  if (!note) return { updated: 0, note: null };

  const { data: issues } = await db
    .from("store_order_issues")
    .select("id,status")
    .eq("order_id", orderId)
    .in("status", [...OPEN_ISSUE_STATUSES]);

  if (!issues?.length) return { updated: 0, note };

  const now = new Date().toISOString();
  const exception = SHIPMENT_EXCEPTION_STATUSES.has(input.mappedStatus.toLowerCase());
  const patch = milestoneIssuePatch(note, now, { exception });

  const ids = issues.map((row) => row.id);
  const { error } = await db.from("store_order_issues").update(patch).in("id", ids);
  if (error) return { updated: 0, note };

  await db.from("store_order_issue_events").insert(
    issues.map((row) => ({
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
    })),
  );

  return { updated: ids.length, note };
}
