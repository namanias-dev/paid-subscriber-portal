import { NextResponse } from "next/server";
import { requireStoreOrderRead } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { issueCategoryLabel, issueStatusLabel, OPEN_ISSUE_STATUSES } from "@/lib/store/issues";
import { issueAnswered, issueNeedsAttention, supportPriorityRank } from "@/lib/store/issueSupport";
import { activeCustomerShipment } from "@/lib/store/deliveryAddress";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type Filter = "needs_attention" | "awaiting_reply" | "open" | "exceptions";

/**
 * Centralized Notes Store customer-service queue.
 * Surfaces open issues, unanswered customer messages, and shipment exceptions.
 */
export async function GET(req: Request) {
  if (!(await requireStoreOrderRead())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStore });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: noStore });

  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") || "needs_attention") as Filter;

  const { data: issues, error } = await db
    .from("store_order_issues")
    .select(
      "id,reference,order_id,order_no,category,description,status,priority,callback_requested,customer_note,milestone_note,admin_note,awaiting_staff_reply,last_customer_message_at,last_staff_reply_at,created_at,updated_at",
    )
    .in("status", [...OPEN_ISSUE_STATUSES])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: noStore });

  const rows = issues || [];
  const orderIds = [...new Set(rows.map((r) => r.order_id))];
  const orderById = new Map<
    string,
    { status: string; customer_name: string; phone: string | null; email: string | null; paid_at: string | null }
  >();
  const shipByOrder = new Map<string, { status: string; courier_name: string | null; awb: string | null }>();
  const latestCustomerMsg = new Map<string, string>();

  if (orderIds.length) {
    const [{ data: orders }, { data: ships }, { data: events }] = await Promise.all([
      db
        .from("store_orders")
        .select("id,status,customer_name,phone,email,paid_at")
        .in("id", orderIds),
      db
        .from("store_shipments")
        .select("order_id,status,courier_name,awb,created_at")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false }),
      db
        .from("store_order_issue_events")
        .select("issue_id,body,event,actor_type,created_at")
        .in(
          "issue_id",
          rows.map((r) => r.id),
        )
        .eq("actor_type", "customer")
        .order("created_at", { ascending: false }),
    ]);
    for (const o of orders || []) {
      orderById.set(o.id, {
        status: o.status,
        customer_name: o.customer_name,
        phone: o.phone,
        email: o.email,
        paid_at: o.paid_at,
      });
    }
    type ShipRow = { order_id: string; status: string; courier_name: string | null; awb: string | null };
    const shipsByOrderLists = new Map<string, ShipRow[]>();
    for (const s of (ships || []) as ShipRow[]) {
      const list = shipsByOrderLists.get(s.order_id) || [];
      list.push(s);
      shipsByOrderLists.set(s.order_id, list);
    }
    for (const [orderId, list] of shipsByOrderLists) {
      const active = activeCustomerShipment(list);
      if (active) {
        shipByOrder.set(orderId, {
          status: active.status,
          courier_name: active.courier_name,
          awb: active.awb,
        });
      }
    }
    for (const ev of events || []) {
      if (latestCustomerMsg.has(ev.issue_id)) continue;
      const body = (ev.body || "").trim();
      if (body) latestCustomerMsg.set(ev.issue_id, body);
    }
  }

  const mapped = rows.map((issue) => {
    const order = orderById.get(issue.order_id);
    const ship = shipByOrder.get(issue.order_id) || null;
    const answered = issueAnswered(issue);
    const needsAttention = issueNeedsAttention({
      status: issue.status,
      awaiting_staff_reply: issue.awaiting_staff_reply,
      last_staff_reply_at: issue.last_staff_reply_at,
      priority: issue.priority,
      shipment_status: ship?.status || null,
      order_status: order?.status || null,
    });
    const exception =
      !!ship?.status &&
      ["delivery_failed", "ndr", "rto", "cancelled", "lost", "damaged"].includes(ship.status);
    const rank = supportPriorityRank({
      priority: issue.priority,
      awaiting_staff_reply: issue.awaiting_staff_reply,
      status: issue.status,
      shipment_status: ship?.status || null,
      order_status: order?.status || null,
      created_at: issue.created_at,
    });
    return {
      id: issue.id,
      reference: issue.reference,
      order_id: issue.order_id,
      order_no: issue.order_no,
      category: issue.category,
      category_label: issueCategoryLabel(issue.category),
      description: issue.description,
      latest_customer_message: latestCustomerMsg.get(issue.id) || issue.description,
      status: issue.status,
      status_label: issueStatusLabel(issue.status),
      priority: issue.priority,
      callback_requested: !!issue.callback_requested,
      customer_note: issue.customer_note,
      milestone_note: issue.milestone_note,
      admin_note: issue.admin_note,
      awaiting_staff_reply: !!issue.awaiting_staff_reply,
      answered,
      needs_attention: needsAttention,
      exception,
      last_customer_message_at: issue.last_customer_message_at,
      last_staff_reply_at: issue.last_staff_reply_at,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      customer_name: order?.customer_name || "—",
      phone: order?.phone || null,
      order_status: order?.status || null,
      paid: !!order?.paid_at,
      shipment_status: ship?.status || null,
      courier: ship?.courier_name || null,
      awb: ship?.awb || null,
      rank,
    };
  });

  const filtered = mapped.filter((row) => {
    if (filter === "open") return true;
    if (filter === "awaiting_reply") return row.awaiting_staff_reply;
    if (filter === "exceptions") return row.exception || row.order_status === "PAYMENT_FAILED";
    return row.needs_attention;
  });

  filtered.sort((a, b) => b.rank - a.rank || Date.parse(a.created_at) - Date.parse(b.created_at));

  const counts = {
    open: mapped.length,
    needs_attention: mapped.filter((r) => r.needs_attention).length,
    awaiting_reply: mapped.filter((r) => r.awaiting_staff_reply).length,
    exceptions: mapped.filter((r) => r.exception || r.order_status === "PAYMENT_FAILED").length,
    unanswered: mapped.filter((r) => !r.answered).length,
  };

  return NextResponse.json({ ok: true, filter, counts, issues: filtered }, { headers: noStore });
}
