import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { staffPaymentLabel } from "@/lib/store/orders";
import { fulfilmentAttention } from "@/lib/store/shipping/dispatch";

export const dynamic = "force-dynamic";

/** Customer-visible/admin status buckets → concrete statuses. */
const BUCKETS: Record<string, string[]> = {
  confirming: ["PAYMENT_PENDING"],
  new: ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED"],
  preparing: ["PROCESSING", "PRINTING", "QUALITY_CHECK", "READY_TO_PACK"],
  packed: ["PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"],
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
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  const statuses = BUCKETS[bucket] || ALL_STATUSES;

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
      "id,order_no,status,customer_name,phone,email,total_paise,discount_paise,subtotal_paise,promo_code,discount_trace_json,promised_delivery_date,placed_at,paid_at,shipped_at,delivered_at,internal_notes,shipping_address_id",
      { count: "exact" },
    )
    .in("status", statuses);

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

  const { data, count } = await query
    .order("placed_at", { ascending: false })
    .range(offset, offset + limit - 1);

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
      pickup_reference: string | null;
      pickup_time: string | null;
      weight_grams: number | null;
      length_cm: number | null;
      width_cm: number | null;
      height_cm: number | null;
    }
  >();
  const payByOrder = new Map<string, { status: string; provider: string | null }>();
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
        };
        shipByOrder.set(s.order_id, {
          courier: s.courier_name,
          awb: s.awb,
          tracking_url: s.tracking_url,
          provider: s.provider,
          status: s.status,
          has_label: Boolean(s.label_r2_key || payload.label_url || ((s.provider === "delhivery" || s.provider === "shiprocket") && s.awb)),
          pickup_scheduled_at: s.pickup_scheduled_at,
          pickup_date: payload.pickup_date || null,
          pickup_status: payload.pickup_status || null,
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
  }

  return NextResponse.json(
    {
      ok: true,
      total: count ?? orders.length,
      limit,
      offset,
      orders: orders.map((o) => ({
        ...o,
        address: o.shipping_address_id ? addrMap.get(o.shipping_address_id) || null : null,
        items: itemsByOrder.get(o.id) || [],
        shipment: shipByOrder.get(o.id) || null,
        past_shipments: pastByOrder.get(o.id) || [],
        attention: fulfilmentAttention({
          orderStatus: o.status,
          awb: shipByOrder.get(o.id)?.awb,
          hasLabel: shipByOrder.get(o.id)?.has_label,
        }),
        payment_status: staffPaymentLabel(payByOrder.get(o.id)?.provider, payByOrder.get(o.id)?.status),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
