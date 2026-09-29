import { NextResponse } from "next/server";
import { requireFreshPermission, requireFreshSuperAdmin, requireStoreOrderRead } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { staffPaymentLabel } from "@/lib/store/orders";
import { fulfilmentAttention } from "@/lib/store/shipping/dispatch";
import { issueCategoryLabel, issueStatusLabel, OPEN_ISSUE_STATUSES } from "@/lib/store/issues";
import { actionRequiredReasons, pickupFailedActivity, sortAdminOrders } from "@/lib/store/adminConsole";
import { shippingWritesAuthorized } from "@/lib/store/shipping/config";
import { BUSINESS_CHANNELS, orderMarketingSummary, type StoredNotesAttribution } from "@/lib/analytics/notesCommerce";
import { paidRollup } from "@/lib/store/opsBoard";
import { groupMatchesBucket, groupNotesCustomers, isCapturedNotesOrder } from "@/lib/store/customerGroups";
import { gatewayChargesForStaff } from "@/lib/store/payments/eazypayAmounts";
import { scheduleStoreInvoice } from "@/lib/store/invoice/issue";

export const dynamic = "force-dynamic";

const INVOICE_GRACE_MS = 5 * 60_000;

/** Customer-visible/admin status buckets → concrete statuses. */
const BUCKETS: Record<string, string[]> = {
  confirming: ["PAYMENT_PENDING"],
  new: ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED"],
  preparing: ["PROCESSING"],
  printing: ["PRINTING", "QUALITY_CHECK", "READY_TO_PACK"],
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
  ...BUCKETS.printing,
  ...BUCKETS.packed,
  ...BUCKETS.pickup,
  ...BUCKETS.shipped,
  ...BUCKETS.delivered,
  ...BUCKETS.cancelled,
  ...BUCKETS.problem,
];

export async function GET(req: Request) {
  if (!(await requireStoreOrderRead())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const canManage = await requireFreshPermission("store_manage_orders");
  const canViewAnalytics = await requireFreshSuperAdmin();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") || "";
  const id = url.searchParams.get("id") || "";
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 25)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const sort = url.searchParams.get("sort") || "newest";
  const actionOnly = url.searchParams.get("action") === "required";
  const acq = url.searchParams.get("acq") || "";

  const paidOnly = bucket === "paid";
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
        return NextResponse.json(
          { ok: true, total: 0, limit, offset, orders: [], can_manage: canManage, can_view_analytics: canViewAnalytics, writes_authorized: shippingWritesAuthorized() },
          { headers: { "Cache-Control": "no-store" } },
        );
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
      "id,order_no,status,customer_id,customer_name,phone,phone_key,email,total_paise,discount_paise,shipping_paise,subtotal_paise,promo_code,discount_trace_json,promised_delivery_date,placed_at,updated_at,paid_at,shipped_at,delivered_at,internal_notes,shipping_address_id,attribution_source,attribution_campaign,attribution_platform,attribution_json",
      { count: "exact" },
    )
    .in("status", !id ? ALL_STATUSES : paidOnly ? ALL_STATUSES.filter((status) => !["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(status)) : statuses);
  if (id) query = query.eq("id", id);
  if (paidOnly && id) query = query.not("paid_at", "is", null);
  if ((BUSINESS_CHANNELS as readonly string[]).includes(acq)) query = query.eq("attribution_platform", acq);
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
  const grouped = !id;
  if (grouped && (q || awbOrderIds?.length)) {
    const keys = await customerKeysForSearch(db, q, awbOrderIds);
    if (!keys.phones.length && !keys.ids.length) {
      const counts = await adminCounts(db);
      return NextResponse.json({ ok: true, total: 0, limit, offset, customers: [], orders: [], counts, can_manage: canManage, can_view_analytics: canViewAnalytics, writes_authorized: shippingWritesAuthorized() }, { headers: { "Cache-Control": "no-store" } });
    }
    const ors = [];
    if (keys.phones.length) ors.push(`phone_key.in.(${keys.phones.join(",")})`);
    if (keys.ids.length) ors.push(`id.in.(${keys.ids.join(",")})`);
    query = db
      .from("store_orders")
      .select(
        "id,order_no,status,customer_id,customer_name,phone,phone_key,email,total_paise,discount_paise,shipping_paise,subtotal_paise,promo_code,discount_trace_json,promised_delivery_date,placed_at,updated_at,paid_at,shipped_at,delivered_at,internal_notes,shipping_address_id,attribution_source,attribution_campaign,attribution_platform,attribution_json",
      )
      .or(ors.join(","));
  }
  const scan = grouped ? 2000 : actionOnly ? 100 : limit;
  const scanOffset = grouped || actionOnly ? 0 : offset;
  const { data, count } = await query.order(sortColumn, { ascending }).range(scanOffset, scanOffset + scan - 1);

  const orders = data || [];
  const ids = orders.map((o) => o.id);
  const addrIds = [...new Set(orders.map((o) => o.shipping_address_id).filter(Boolean))] as string[];

  const addrMap = new Map<string, Record<string, unknown>>();
  if (addrIds.length) {
    const { data: addrs } = await db
      .from("store_addresses")
      .select("id,name,phone,line1,line2,city,state,pincode,landmark,delivery_instructions,confirmation_status,address_hash")
      .in("id", addrIds);
    for (const a of addrs || []) addrMap.set(a.id, a);
  }

  const itemsByOrder = new Map<string, Array<{ name: string; qty: number; sku: string; unit_price_paise: number; line_total_paise: number }>>();
  const pastByOrder = new Map<string, Array<{ provider: string | null; courier: string | null; awb: string | null; status: string | null; reason: string | null }>>();
  const cityConfirmByOrder = new Map<string, { customer_destination: string; courier_destination: string; pin: "MATCH"; state: "MATCH"; courier: string; awb: string; rate_paise: number | null }>();
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
      package_source: string | null;
      rate_paise: number | null;
    }
  >();
  const payByOrder = new Map<string, { status: string; provider: string | null; verify_payload: unknown }>();
  const invoiceByOrder = new Map<string, string>();
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
          do_not_use?: boolean;
        };
        const list = pastByOrder.get(s.order_id) || [];
        list.push({
          provider: s.provider,
          courier: s.courier_name,
          awb: s.awb,
          status: s.status,
          reason: payload.cancellation_reason || payload.reason || (payload.do_not_use ? "CANCELLED / DO NOT USE" : null),
        });
        pastByOrder.set(s.order_id, list);
      }
      const livePayload = (s.provider_payload && typeof s.provider_payload === "object" ? s.provider_payload : {}) as {
        city_confirm_required?: boolean;
        destination_accepted?: boolean;
        requested_city?: string;
        requested_state?: string;
        requested_pin?: string;
        provider_city?: string;
        provider_state?: string;
        provider_pin?: string;
        booked_rate_paise?: number;
        rate_paise?: number;
      };
      const awaitingCity = !inactive && livePayload.city_confirm_required === true && livePayload.destination_accepted !== true && Boolean(s.awb);
      if (awaitingCity && !shipByOrder.has(s.order_id) && !cityConfirmByOrder.has(s.order_id) && livePayload.provider_city && livePayload.requested_city) {
        cityConfirmByOrder.set(s.order_id, {
          customer_destination: `${livePayload.requested_city}, ${livePayload.requested_state || ""} — ${livePayload.requested_pin || ""}`,
          courier_destination: `${livePayload.provider_city}, ${livePayload.provider_state || ""} — ${livePayload.provider_pin || livePayload.requested_pin || ""}`,
          pin: "MATCH",
          state: "MATCH",
          courier: s.courier_name || "",
          awb: s.awb || "",
          rate_paise: Number(livePayload.booked_rate_paise) || Number(livePayload.rate_paise) || null,
        });
      }
      if (inactive || awaitingCity || shipByOrder.has(s.order_id)) continue;
      {
        const payload = livePayload as typeof livePayload & {
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
          package_source?: string;
          do_not_use?: boolean;
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
          package_source: payload.package_source || null,
          rate_paise: Number(payload.booked_rate_paise) || Number(payload.rate_paise) || null,
        });
      }
    }
    const { data: payRows } = await db
      .from("store_order_payments")
      .select("order_id,status,provider,created_at,verify_payload")
      .in("order_id", ids)
      .order("created_at", { ascending: false });
    for (const p of payRows || []) {
      if (!payByOrder.has(p.order_id)) {
        payByOrder.set(p.order_id, { status: p.status, provider: p.provider || null, verify_payload: p.verify_payload });
      }
    }
    const { data: invoiceRows } = await db.from("store_invoices").select("order_id,status").in("order_id", ids);
    for (const row of invoiceRows || []) invoiceByOrder.set(row.order_id, row.status);
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

  let invoiceHeals = 0;
  const mapped = orders.map((o) => {
    const ship = shipByOrder.get(o.id) || null;
    const issue = issueByOrder.get(o.id) || null;
    const { attribution_json, ...safe } = o;
    const storedInvoice = invoiceByOrder.get(o.id) || null;
    const paid = Boolean(o.paid_at) && !["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED"].includes(o.status);
    if (paid && !storedInvoice && invoiceHeals < 3) {
      invoiceHeals += 1;
      scheduleStoreInvoice(o.id);
    }
    const invoiceOverdue = paid && !storedInvoice && Date.now() - Date.parse(String(o.paid_at)) > INVOICE_GRACE_MS;
    const invoiceStatus = storedInvoice || (paid ? (invoiceOverdue ? "MISSING" : "PENDING") : null);
    const reasons = actionRequiredReasons({
      status: o.status,
      awb: ship?.awb,
      pickupFailed: pickupFailedActivity(ship?.tracking_activity),
      addressMismatch: Boolean(ship?.address_mismatch),
      openIssue: Boolean(issue?.open),
      paymentPending: o.status === "PAYMENT_PENDING",
      cityConfirm: !ship && cityConfirmByOrder.has(o.id),
      invoiceStatus,
    });
    return {
      ...safe,
      marketing: orderMarketingSummary({
        attribution_source: o.attribution_source,
        attribution_platform: o.attribution_platform,
        attribution_json: (attribution_json || null) as StoredNotesAttribution | null,
      }),
      address: o.shipping_address_id ? addrMap.get(o.shipping_address_id) || null : null,
      items: itemsByOrder.get(o.id) || [],
      shipment: ship,
      city_confirmation: cityConfirmByOrder.get(o.id) || null,
      past_shipments: pastByOrder.get(o.id) || [],
      attention: fulfilmentAttention({
        orderStatus: o.status,
        awb: ship?.awb,
        hasLabel: ship?.has_label,
      }),
      action_required: reasons.length > 0,
      action_reasons: reasons,
      payment_status: staffPaymentLabel(payByOrder.get(o.id)?.provider, payByOrder.get(o.id)?.status),
      gateway_charges: gatewayChargesForStaff(payByOrder.get(o.id)?.verify_payload, Number(o.total_paise) || 0),
      invoice_status: invoiceStatus,
      issue,
    };
  });
  const counts = await adminCounts(db);
  if (id && mapped[0]?.phone_key) {
    const { data: siblings } = await db
      .from("store_orders")
      .select("id,order_no,status,total_paise,placed_at,paid_at")
      .eq("phone_key", mapped[0].phone_key)
      .order("placed_at", { ascending: false })
      .limit(40);
    (mapped[0] as { attempts?: unknown }).attempts = (siblings || []).map((row) => ({ ...row, captured: isCapturedNotesOrder(row) }));
  }
  if (!id) {
    const needle = q.toLowerCase();
    const groups = groupNotesCustomers(mapped, q ? (order) => `${order.order_no} ${order.customer_name || ""} ${order.phone || ""} ${order.phone_key || ""} ${order.email || ""}`.toLowerCase().includes(needle) : undefined);
    const filtered = groups.filter((group) => groupMatchesBucket(group, issueFilter === "open" || actionOnly ? "issues" : bucket));
    const customers = filtered.slice(offset, offset + limit);
    return NextResponse.json(
      {
        ok: true,
        total: filtered.length,
        limit,
        offset,
        writes_authorized: shippingWritesAuthorized(),
        can_manage: canManage,
        can_view_analytics: canViewAnalytics,
        counts,
        customers,
        orders: customers.map((group) => ({
          ...group.primary,
          group: {
            attempts: group.attempts,
            paid_count: group.paid_count,
            paid_total_paise: group.paid_total_paise,
            masked_phone: group.masked_phone,
            matched_order_no: group.matched_order_no,
            active: group.active.map((order) => ({
              id: order.id,
              order_no: order.order_no,
              status: order.status,
              items: "items" in order ? order.items : [],
            })),
          },
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const visible = sortAdminOrders(actionOnly ? mapped.filter((row) => row.action_required) : mapped, sort === "action" ? "action" : "newest");
  const page = actionOnly ? visible.slice(offset, offset + limit) : sort === "action" ? visible : mapped;

  return NextResponse.json(
    {
      ok: true,
      total: actionOnly ? visible.length : count ?? orders.length,
      limit,
      offset,
      writes_authorized: shippingWritesAuthorized(),
      can_manage: canManage,
      can_view_analytics: canViewAnalytics,
      counts,
      orders: page,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function customerKeysForSearch(db: NonNullable<ReturnType<typeof storeDb>>, q: string, awbOrderIds: string[] | null) {
  let lookup = db.from("store_orders").select("id,phone_key").limit(200);
  if (q) {
    const like = `%${q.replace(/[%,]/g, "")}%`;
    const ors = [`order_no.ilike.${like}`, `customer_name.ilike.${like}`, `phone.ilike.${like}`, `email.ilike.${like}`];
    if (awbOrderIds?.length) ors.push(`id.in.(${awbOrderIds.join(",")})`);
    lookup = lookup.or(ors.join(","));
  } else if (awbOrderIds?.length) {
    lookup = lookup.in("id", awbOrderIds);
  }
  const { data } = await lookup;
  const phones = [...new Set((data || []).map((row) => row.phone_key).filter(Boolean))] as string[];
  const ids = (data || []).filter((row) => !row.phone_key).map((row) => row.id) as string[];
  return { phones, ids };
}

async function adminCounts(db: NonNullable<ReturnType<typeof storeDb>>) {
  async function count(statuses: string[]) {
    const { count: n } = await db.from("store_orders").select("id", { count: "exact", head: true }).in("status", statuses);
    return n || 0;
  }
  const [total, fresh, preparing, printing, packed, pickup, transit, delivered] = await Promise.all([
    count(ALL_STATUSES),
    count(BUCKETS.new),
    count(BUCKETS.preparing),
    count(BUCKETS.printing),
    count(["PACKED", "READY_FOR_PICKUP"]),
    count(["PICKUP_SCHEDULED"]),
    count(BUCKETS.shipped),
    count(BUCKETS.delivered),
  ]);
  const { count: issues } = await db
    .from("store_order_issues")
    .select("id", { count: "exact", head: true })
    .in("status", [...OPEN_ISSUE_STATUSES]);
  const { data: paidRows } = await db
    .from("store_orders")
    .select("id,status,paid_at,total_paise")
    .not("paid_at", "is", null)
    .limit(5000);
  const captured = (paidRows || []).filter((row) => row.paid_at && !["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(row.status));
  const paid = paidRollup(captured);
  const products = await paidProductSplit(db, captured.map((row) => row.id));
  const { data: heads } = await db.from("store_orders").select("id,order_no,status,paid_at,phone,phone_key,customer_id,customer_name,placed_at").limit(5000);
  const groups = groupNotesCustomers((heads || []) as Array<{ id: string; order_no: string; status: string; paid_at: string | null; phone: string | null; phone_key: string | null; customer_id: string | null; customer_name: string | null; placed_at: string | null }>);
  return {
    total,
    attempts: (heads || []).length,
    customers: groups.length,
    paid_customers: groups.filter((group) => group.paid_count > 0).length,
    paid: paid.orders,
    paid_sales_paise: paid.salesPaise,
    products,
    new: fresh,
    preparing,
    printing,
    packed,
    pickup,
    transit,
    delivered,
    issues: issues || 0,
  };
}

async function paidProductSplit(db: NonNullable<ReturnType<typeof storeDb>>, ids: string[]) {
  if (!ids.length) return [];
  const { data } = await db.from("store_order_items").select("order_id,name_snapshot,qty").in("order_id", ids);
  const byName = new Map<string, { orders: Set<string>; units: number }>();
  for (const row of data || []) {
    const name = String(row.name_snapshot || "Notes");
    const slot = byName.get(name) || { orders: new Set<string>(), units: 0 };
    slot.orders.add(String(row.order_id));
    slot.units += Number(row.qty) || 0;
    byName.set(name, slot);
  }
  return [...byName.entries()]
    .map(([name, slot]) => ({ name, orders: slot.orders.size, units: slot.units }))
    .sort((a, b) => b.units - a.units || b.orders - a.orders);
}
