import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { staffPaymentLabel } from "@/lib/store/orders";
import { fulfilmentAttention } from "@/lib/store/shipping/dispatch";
import { issueCategoryLabel, issueStatusLabel, OPEN_ISSUE_STATUSES } from "@/lib/store/issues";
import { actionRequiredReasons, pickupFailedActivity, sortAdminOrders } from "@/lib/store/adminConsole";
import { shippingWritesAuthorized } from "@/lib/store/shipping/config";

export const dynamic = "force-dynamic";

/** Customer-visible/admin status buckets → concrete statuses. */
const BUCKETS: Record<string, string[]> = {
  confirming: ["PAYMENT_PENDING"],
  new: ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED"],
  preparing: ["PROCESSING", "PRINTING", "QUALITY_CHECK", "READY_TO_PACK"],
  packed: ["PACKED", "READY_FOR_PICKUP"],
  pickup: ["PICKUP_SCHEDULED"],
  shipped: ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"],
  delivered: ["DELIVERED"],
  cancelled: ["CANCELLED", "CANCEL_REQUESTED", "PAYMENT_FAILED", "PAYMENT_EXPIRED"],
  problem: [
    "DELIVERY_FAILED",
    "REATTEMPT_REQUESTED",
    "RTO_INITIATED",
    "RTO_IN_TRANSIT",
    "RTO_DELIVERED",
    "RETURN_REQUESTED",
    "RETURN_APPROVED",
    "RETURN_PICKUP_SCHEDULED",
    "RETURN_IN_TRANSIT",
    "RETURN_RECEIVED",
    "REFUND_PENDING",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
  ],
};

/** Everything except the pre-payment pending state (which is not an order yet). */
const ALL_STATUSES = [
  ...BUCKETS.confirming,
  ...BUCKETS.new,
  ...BUCKETS.preparing,
  ...BUCKETS.packed,
  ...BUCKETS.shipped,
  ...BUCKETS.delivered,
  ...BUCKETS.cancelled,
  ...BUCKETS.problem,
];

export async function GET(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") || "";
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 25)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const sort = url.searchParams.get("sort") || "newest";
  const actionOnly = url.searchParams.get("action") === "required";

  const statuses = BUCKETS[bucket] || ALL_STATUSES;
  const issueFilter = url.searchParams.get("issue") || "";
  let openIssueOrderIds: string[] | null = null;
  if (issueFilter === "open") {
    const { data: openRows, error: openError } = await db
      .from("store_order_issues")
      .select("order_id")
      .in("status", [...OPEN_ISSUE_STATUSES])
      .limit(200);
    if (!openError) {
      openIssueOrderIds = [...new Set((openRows || []).map((row) => row.order_id).filter(Boolean))] as string[];
      if (!openIssueOrderIds.length) {
        return NextResponse.json({ ok: true, total: 0, limit, offset, orders: [] }, { headers: { "Cache-Control": "no-store" } });
      }
    }
  }

  // AWB search: resolve matching order ids from shipments first.
  let awbOrderIds: string[] | null = null;
  if (q) {
    const { data: ships } = await db
      .from("store_shipments")
      .select("order_id,awb")
      .ilike("awb", `%${q}%`)
      .limit(50);
    const ids = (ships || []).map((s) => s.order_id).filter(Boolean);
    if (ids.length) awbOrderIds = ids as string[];
  }

  let query = db
    .from("store_orders")
    .select(
      "id,order_no,status,customer_name,phone,email,total_paise,discount_paise,shipping_paise,subtotal_paise,promo_code,discount_trace_json,promised_delivery_date,placed_at,updated_at,paid_at,shipped_at,delivered_at,internal_notes,shipping_address_id",
      { count: "exact" },
    )
    .in("status", statuses);
  if (openIssueOrderIds) query = query.in("id", openIssueOrderIds);

  if (q) {
    const like = `%${q.replace(/[%,]/g, "")}%`;
    const ors = [
      `order_no.ilike.${like}`,
      `customer_name.ilike.${like}`,
      `phone.ilike.${like}`,
      `email.ilike.${like}`,
    ];
    if (awbOrderIds?.length) ors.push(`id.in.(${awbOrderIds.join(",")})`);
    query = query.or(ors.join(","));
  }

  const sortColumn = sort.startsWith("value") ? "total_paise" : sort === "updated" || sort === "action" ? "updated_at" : "placed_at";
  const ascending = sort === "oldest" || sort === "value_asc";
  const scan = actionOnly ? 100 : limit;
  const scanOffset = actionOnly ? 0 : offset;
  const { data, count } = await query.order(sortColumn, { ascending }).range(scanOffset, scanOffset + scan - 1);

  const orders = data || [];
  const ids = orders.map((o) => o.id);
  const addrIds = [...new Set(orders.map((o) => o.shipping_address_id).filter(Boolean))] as string[];

  const addrMap = new Map<string, Record<string, unknown>>();
  if (addrIds.length) {
    const { data: addrs } = await db
      .from("store_addresses")
      .select("id,name,phone,line1,line2,city,state,pincode,landmark,delivery_instructions")
      .in("id", addrIds);
    for (const a of addrs || []) addrMap.set(a.id, a);
  }

  const itemsByOrder = new Map<string, Array<{ name: string; qty: number; sku: string; unit_price_paise: number; line_total_paise: number }>>();
  const pastByOrder = new Map<string, Array<{ provider: string | null; courier: string | null; awb: string | null; status: string | null; reason: string | null }>>();
  const shipByOrder = new Map<
    string,
    {
      courier: string | null;
      awb: string | null;
      tracking_url: string | null;
      provider: string | null;
      status: string | null;
      has_label: boolean;
      pickup_scheduled_at: string | null;
      pickup_date: string | null;
      pickup_status: string | null;
      tracking_activity: string | null;
      tracking_event_at: string | null;
      tracking_location: string | null;
      address_mismatch: boolean;
      pickup_reference: string | null;
      pickup_time: string | null;
      weight_grams: number | null;
      length_cm: number | null;
      width_cm: number | null;
      height_cm: number | null;
    }
  >();
  const payByOrder = new Map<string, { status: string; provider: string | null }>();
  const issueByOrder = new Map<
    string,
    {
      id: string;
      reference: string;
      category: string;
      category_label: string;
      status: string;
      status_label: string;
      description: string;
      created_at: string;
      customer_note: string | null;
      admin_note: string | null;
      callback_requested: boolean;
      open: boolean;
    }
  >();
  if (ids.length) {
    const { data: itemRows } = await db
      .from("store_order_items")
      .select("order_id,name_snapshot,qty,sku_snapshot,unit_price_paise,line_total_paise")
      .in("order_id", ids);
    for (const it of itemRows || []) {
      const list = itemsByOrder.get(it.order_id) || [];
      list.push({
        name: it.name_snapshot,
        qty: it.qty,
        sku: it.sku_snapshot,
        unit_price_paise: Number(it.unit_price_paise) || 0,
        line_total_paise: Number(it.line_total_paise) || 0,
      });
      itemsByOrder.set(it.order_id, list);
    }
    const { data: shipRows } = await db
      .from("store_shipments")
      .select("order_id,courier_name,awb,tracking_url,provider,status,label_r2_key,provider_payload,pickup_scheduled_at,weight_grams,length_mm,width_mm,height_mm,created_at")
      .in("order_id", ids)
      .order("created_at", { ascending: false });
    for (const s of shipRows || []) {
      const inactive = s.status === "cancelled" || s.status === "failed";
      if (inactive) {
        const payload = (s.provider_payload && typeof s.provider_payload === "object" ? s.provider_payload : {}) as {
          cancellation_reason?: string;
          reason?: string;
        };
        const list = pastByOrder.get(s.order_id) || [];
        list.push({
          provider: s.provider,
          courier: s.courier_name,
          awb: s.awb,
          status: s.status,
          reason: payload.cancellation_reason || payload.reason || null,
        });
        pastByOrder.set(s.order_id, list);
      }
      if (inactive || shipByOrder.has(s.order_id)) continue;
      {
        const payload = (s.provider_payload && typeof s.provider_payload === "object" ? s.provider_payload : {}) as {
          label_url?: string;
          pickup_reference?: string;
          pickup_time?: string;
          pickup_date?: string;
          pickup_status?: string;
          pickup_reattempt_date?: string;
          tracking_activity?: string;
          tracking_event_at?: string;
          tracking_location?: string;
          address_mismatch?: boolean;
          do_not_handoff?: boolean;
        };
        shipByOrder.set(s.order_id, {
          courier: s.courier_name,
          awb: s.awb,
          tracking_url: s.tracking_url,
          provider: s.provider,
          status: s.status,
          has_label: Boolean(s.label_r2_key || payload.label_url || ((s.provider === "delhivery" || s.provider === "shiprocket") && s.awb)),
          pickup_scheduled_at: s.pickup_scheduled_at,
          pickup_date: payload.pickup_reattempt_date || payload.pickup_date || null,
          pickup_status: payload.pickup_status || null,
          tracking_activity: payload.tracking_activity || null,
          tracking_event_at: payload.tracking_event_at || null,
          tracking_location: payload.tracking_location || null,
          address_mismatch: Boolean(payload.address_mismatch || payload.do_not_handoff),
          pickup_reference: payload.pickup_reference || null,
          pickup_time: payload.pickup_time || null,
          weight_grams: s.weight_grams ?? null,
          length_cm: s.length_mm ? Number(s.length_mm) / 10 : null,
          width_cm: s.width_mm ? Number(s.width_mm) / 10 : null,
          height_cm: s.height_mm ? Number(s.height_mm) / 10 : null,
        });
      }
    }
    const { data: payRows } = await db
      .from("store_order_payments")
      .select("order_id,status,provider,created_at")
      .in("order_id", ids)
      .order("created_at", { ascending: false });
    for (const p of payRows || []) {
      if (!payByOrder.has(p.order_id)) payByOrder.set(p.order_id, { status: p.status, provider: p.provider || null });
    }
    const { data: issueRows, error: issueError } = await db
      .from("store_order_issues")
      .select("id,order_id,reference,category,status,description,created_at,customer_note,admin_note,callback_requested")
      .in("order_id", ids)
      .order("created_at", { ascending: false });
    if (!issueError) {
      for (const issue of issueRows || []) {
        const current = issueByOrder.get(issue.order_id);
        const open = (OPEN_ISSUE_STATUSES as readonly string[]).includes(issue.status);
        if (current?.open && !open) continue;
        if (current && !open) continue;
        issueByOrder.set(issue.order_id, {
          id: issue.id,
          reference: issue.reference,
          category: issue.category,
          category_label: issueCategoryLabel(issue.category),
          status: issue.status,
          status_label: issueStatusLabel(issue.status),
          description: issue.description,
          created_at: issue.created_at,
          customer_note: issue.customer_note,
          admin_note: issue.admin_note,
          callback_requested: !!issue.callback_requested,
          open,
        });
      }
    }
  }

  const mapped = orders.map((o) => {
    const ship = shipByOrder.get(o.id) || null;
    const issue = issueByOrder.get(o.id) || null;
    const reasons = actionRequiredReasons({
      status: o.status,
      awb: ship?.awb,
      pickupFailed: pickupFailedActivity(ship?.tracking_activity),
      addressMismatch: Boolean(ship?.address_mismatch),
      openIssue: Boolean(issue?.open),
      paymentPending: o.status === "PAYMENT_PENDING",
    });
    return {
      ...o,
      address: o.shipping_address_id ? addrMap.get(o.shipping_address_id) || null : null,
      items: itemsByOrder.get(o.id) || [],
      shipment: ship,
      past_shipments: pastByOrder.get(o.id) || [],
      attention: fulfilmentAttention({
        orderStatus: o.status,
        awb: ship?.awb,
        hasLabel: ship?.has_label,
      }),
      action_required: reasons.length > 0,
      action_reasons: reasons,
      payment_status: staffPaymentLabel(payByOrder.get(o.id)?.provider, payByOrder.get(o.id)?.status),
      issue,
    };
  });
  const visible = sortAdminOrders(actionOnly ? mapped.filter((row) => row.action_required) : mapped, sort === "action" ? "action" : "newest");
  const page = actionOnly ? visible.slice(offset, offset + limit) : sort === "action" ? visible : mapped;
  const counts = await adminCounts(db);

  return NextResponse.json(
    {
      ok: true,
      total: actionOnly ? visible.length : count ?? orders.length,
      limit,
      offset,
      writes_authorized: shippingWritesAuthorized(),
      counts,
      orders: page,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function adminCounts(db: NonNullable<ReturnType<typeof storeDb>>) {
  async function count(statuses: string[]) {
    const { count: n } = await db.from("store_orders").select("id", { count: "exact", head: true }).in("status", statuses);
    return n || 0;
  }
  const [total, fresh, preparing, packed, pickup, transit, delivered] = await Promise.all([
    count(ALL_STATUSES),
    count(BUCKETS.new),
    count(BUCKETS.preparing),
    count(["PACKED", "READY_FOR_PICKUP"]),
    count(["PICKUP_SCHEDULED"]),
    count(BUCKETS.shipped),
    count(BUCKETS.delivered),
  ]);
  const { count: issues } = await db
    .from("store_order_issues")
    .select("id", { count: "exact", head: true })
    .in("status", [...OPEN_ISSUE_STATUSES]);
  return {
    total,
    new: fresh,
    preparing,
    packed,
    pickup,
    transit,
    delivered,
    issues: issues || 0,
  };
}
