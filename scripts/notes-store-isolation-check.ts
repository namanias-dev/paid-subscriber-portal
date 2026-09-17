#!/usr/bin/env npx tsx
/**
 * Post-payment isolation evidence for one store order.
 *
 * Usage:
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/notes-store-isolation-check.ts NIAS-N-1001
 *
 * This lives under scripts/, not lib/store, so it may read academy tables.
 * It writes nothing.
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { isStoreReference } from "../lib/store/references";

function digits10(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

async function countSince(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, table: string, phoneCol: string, phone: string, sinceIso: string) {
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(phoneCol, phone)
    .gte("created_at", sinceIso);
  if (error) return { count: null as number | null, error: error.message };
  return { count: count ?? 0, error: null as string | null };
}

async function main() {
  const orderNo = (process.argv[2] || "").trim().toUpperCase();
  if (!orderNo) {
    console.error("Usage: notes-store-isolation-check.ts <order_no>");
    process.exit(2);
  }
  const db = getSupabaseAdmin();
  if (!db) {
    console.error("database unavailable");
    process.exit(1);
  }

  const { data: order, error: orderErr } = await db
    .from("store_orders")
    .select("id,order_no,status,phone,phone_key,placed_at,paid_at,total_paise,amount_paid_paise")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (orderErr || !order) {
    console.error(JSON.stringify({ ok: false, error: orderErr?.message || "order not found" }));
    process.exit(1);
  }

  const { data: payments } = await db
    .from("store_order_payments")
    .select("reference_no,status,amount_paise,raw_verify_status,verify_attempts,captured_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  const { data: events } = await db
    .from("store_order_events")
    .select("event,from_status,to_status,created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  const { data: callbackEvents } = await db
    .from("store_payment_events")
    .select("event_id,processing_result,created_at")
    .eq("reference_no", payments?.[0]?.reference_no || "")
    .order("created_at", { ascending: true });

  const { data: reservations } = await db
    .from("store_inventory_reservations")
    .select("product_id,qty,expires_at,released_at,committed_at")
    .eq("order_id", order.id);

  const { data: items } = await db.from("store_order_items").select("product_id,qty,sku_snapshot").eq("order_id", order.id);
  const productIds = [...new Set((items || []).map((i) => i.product_id))];
  const { data: products } = productIds.length
    ? await db.from("store_products").select("id,sku,on_hand,reserved").in("id", productIds)
    : { data: [] as Array<{ id: string; sku: string; on_hand: number; reserved: number }> };

  const { data: ledger } = productIds.length
    ? await db
        .from("store_stock_ledger")
        .select("product_id,delta,reason,ref_id,created_at")
        .in("product_id", productIds)
        .eq("ref_id", order.id)
        .order("created_at", { ascending: true })
    : { data: [] as Array<{ product_id: string; delta: number; reason: string; ref_id: string; created_at: string }> };

  const since = new Date(new Date(order.placed_at).getTime() - 60_000).toISOString();
  const phone = digits10(order.phone || order.phone_key || "");

  const studentsNew = await countSince(db, "students", "phone", phone, since);
  const buyersNew = await countSince(db, "buyers", "phone", phone, since);
  const leadsNew = await countSince(db, "leads", "phone", phone, since);

  const { count: academyStoreRefs, error: payErr } = await db
    .from("payments")
    .select("id", { count: "exact", head: true })
    .like("reference_no", "NIASN-N-%");

  const { count: academyPhonePays } = await db
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", since);

  const { count: analyticsPaid } = await db
    .from("analytics_events")
    .select("event_id", { count: "exact", head: true })
    .eq("event_name", "payment_paid")
    .eq("phone", phone)
    .gte("occurred_at", since);

  const { count: smsLogs } = await db
    .from("sms_logs")
    .select("id", { count: "exact", head: true })
    .eq("normalized_mobile", phone)
    .gte("created_at", since);

  const refs = (payments || []).map((p) => p.reference_no);
  const capturedCount = (payments || []).filter((p) => p.status === "CAPTURED").length;
  const callbackResults = (callbackEvents || []).map((e) => e.processing_result);

  const report = {
    ok: true,
    order: {
      order_no: order.order_no,
      status: order.status,
      total_paise: order.total_paise,
      amount_paid_paise: order.amount_paid_paise,
      placed_at: order.placed_at,
      paid_at: order.paid_at,
    },
    payments: payments || [],
    events: events || [],
    inventory: { reservations: reservations || [], products: products || [], ledger: ledger || [] },
    isolation: {
      store_refs_well_formed: refs.every((r) => isStoreReference(r)),
      captured_exactly_once: capturedCount === 1 && order.status === "ORDER_CONFIRMED",
      callback_results: callbackResults,
      new_students: studentsNew,
      new_buyers: buyersNew,
      new_leads: leadsNew,
      academy_payments_with_store_ref: { count: academyStoreRefs ?? 0, error: payErr?.message || null },
      academy_payments_same_phone_since: academyPhonePays ?? 0,
      analytics_payment_paid_since: analyticsPaid ?? 0,
      sms_logs_since: smsLogs ?? 0,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
