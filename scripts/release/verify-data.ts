/**
 * Read-only production data verification for data-heavy releases.
 *
 *   npm run release:verify-data -- notes-analytics [range]     (range: today|yesterday|7d|30d|month, default 30d)
 *
 * Reads production through the logged-in Supabase CLI (`supabase db query --linked`,
 * management API). No service-role key is read or stored. Every statement is an
 * allowlisted SELECT, checked for mutation keywords, and wrapped in
 * `begin transaction read only … rollback`, so Postgres itself rejects writes.
 *
 * The SELECTs fetch the same columns and filters as the dashboard loaders
 * (lib/analytics/notesReport.ts, lib/analytics/notesIntelLoad.ts). The numbers are
 * computed by the same pure functions production uses. Exit code 1 when an
 * invariant fails or the guard trips.
 */
import { execFileSync } from "node:child_process";
import { aggregateNotesAnalytics, notesRangeBounds, type NotesEventRow, type NotesItemFact, type NotesOrderFact, type NotesRangeKey } from "../../lib/analytics/notesCommerce";
import { buildNotesVisuals, destinationForOrder, type NotesDestination } from "../../lib/analytics/notesVisuals";
import { buildNotesIntel, type IntelBundleItem, type IntelItem, type IntelOrder, type IntelProduct, type IntelShipment } from "../../lib/analytics/notesIntel";
import { timelineSeries } from "../../lib/analytics/notesTimeline";
import { EVENT_NAMES, MAX_NOTES_EVENTS } from "../../lib/analytics/notesReport";
import { MAX_ORDERS, SHIPMENT_STATUSES } from "../../lib/analytics/notesIntelLoad";
import { shippingRateStats, type ShipmentRowLike } from "../../lib/store/orderOps";
import { planLocalRepair, type CourierProvider } from "../../lib/store/shipping/pickup";
import { isQaNotesOrder, type StoredNotesAttribution } from "../../lib/analytics/notesCommerce";
import { formatPaise } from "../../lib/store/money";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "xqwdfyzerzsllqiyzxem";
const MUTATION = /\b(insert|update|delete|upsert|merge|truncate|alter|drop|create|grant|revoke|copy|call|do|execute|vacuum|reindex|refresh|lock|comment|cluster|listen|notify|security\s+definer|set\s+role|nextval|setval|pg_terminate_backend|pg_cancel_backend|dblink)\b/i;

let failed = false;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

function guard() {
  const overrides = ["ALLOW_TEST_DB_WRITES", "NOTES_STORE_SHIPPING_WRITES", "ALLOW_PRODUCTION_WRITES"].filter((key) => ["1", "true"].includes(String(process.env[key] || "").toLowerCase()));
  if (overrides.length) throw new Error(`Refusing to run: production write override set (${overrides.join(", ")}).`);
}

/** Allowlisted read: a single SELECT/WITH statement, executed in a read-only transaction. */
function select<T>(sql: string): T[] {
  const body = sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(body) || body.includes(";")) throw new Error("Only single SELECT statements are allowed.");
  if (MUTATION.test(body.replace(/'[^']*'/g, "''"))) throw new Error(`Rejected statement with a mutation keyword: ${body.slice(0, 80)}`);
  const wrapped = `begin transaction read only; ${body}; rollback;`;
  const out = execFileSync("supabase", ["db", "query", "--linked", "--project-ref", PROJECT_REF, "--output-format", "json", wrapped], {
    encoding: "utf8",
    cwd: "/tmp",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out.slice(out.indexOf("{")));
  return (parsed.rows || []) as T[];
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
const list = (values: string[]) => (values.length ? values.map(q).join(",") : "NULL");

async function notesAnalytics(range: NotesRangeKey) {
  const now = new Date();
  const bounds = notesRangeBounds(range, now);
  const today = notesRangeBounds("today", now);
  const from = q(bounds.start.toISOString());
  const to = q(bounds.end.toISOString());

  // ---- notesReport.loadFacts (KPI row, funnel, sales chart)
  const events = select<NotesEventRow>(`select event_name, session_id, visitor_id, occurred_at, page_path, device, attribution, props, is_bot
    from public.analytics_events where event_name in (${list(EVENT_NAMES)}) and occurred_at >= ${from} and occurred_at < ${to}
    and is_bot = false order by occurred_at asc, event_id asc limit ${MAX_NOTES_EVENTS + 1}`);
  const rangeOrders = select<NotesOrderFact>(`select id, status, total_paise, discount_paise, paid_at, promo_code, attribution_source, attribution_platform, attribution_json, shipping_address_id, fulfillment_method, customer_location_snapshot
    from public.store_orders where paid_at is not null and paid_at >= ${from} and paid_at < ${to} order by paid_at asc, id asc`);
  const rangeItems = select<NotesItemFact>(`select order_id, product_id, name_snapshot, sku_snapshot, line_total_paise, qty
    from public.store_order_items where order_id in (${list(rangeOrders.map((o) => o.id))})`);

  // ---- notesIntelLoad.loadNotesIntel (intelligence sections)
  const orders = select<IntelOrder>(`select id, order_no, status, total_paise, shipping_paise, discount_paise, paid_at, shipped_at, delivered_at, shipping_address_id, promo_code, attribution_source, attribution_json, fulfillment_method, ready_for_collection_at, collected_at, customer_location_snapshot
    from public.store_orders where paid_at is not null order by paid_at asc, id asc limit ${MAX_ORDERS}`);
  const ids = orders.map((o) => o.id);
  const shipIds = orders.filter((o) => SHIPMENT_STATUSES.has(o.status) || o.shipped_at || o.delivered_at).map((o) => o.id);
  const products = select<IntelProduct>(`select id, name, short_name, subject, kind, selling_price_paise, weight_grams, length_mm, width_mm, height_mm from public.store_products limit 1000`);
  const bundles = select<IntelBundleItem>(`select bundle_id, component_id, qty from public.store_bundle_items limit 2000`);
  const items = select<IntelItem>(`select order_id, product_id, name_snapshot, qty, line_total_paise, weight_grams_snapshot from public.store_order_items where order_id in (${list(ids)})`);
  const shipments = select<IntelShipment>(`select order_id, provider, courier_name, status, awb, provider_payload, weight_grams, length_mm, width_mm, height_mm, picked_up_at, delivered_at, created_at
    from public.store_shipments where order_id in (${list(shipIds)})`);
  // notesReport.loadDestinations: invoice snapshot city/state, else the order's address city/state. No other address fields are read.
  const snaps = select<{ order_id: string; city: string | null; state: string | null }>(`select order_id, shipping_snapshot->>'city' as city, shipping_snapshot->>'state' as state
    from public.store_invoices where order_id in (${list(ids)})`);
  const addressIds = orders.map((o) => o.shipping_address_id).filter((id): id is string => Boolean(id));
  const addresses = select<{ id: string; city: string | null; state: string | null }>(`select id, city, state from public.store_addresses where id in (${list(addressIds)})`);
  const snapBy = new Map(snaps.filter((s) => (s.city || "").trim() || (s.state || "").trim()).map((s) => [s.order_id, s]));
  const addrBy = new Map(addresses.map((a) => [a.id, a]));
  const destinations: NotesDestination[] = orders.map((o) => destinationForOrder(o.id, snapBy.get(o.id), o.shipping_address_id ? addrBy.get(o.shipping_address_id) : null, o.customer_location_snapshot || null));

  const report = aggregateNotesAnalytics(events, rangeOrders, rangeItems);
  const visuals = buildNotesVisuals({ events, orders: rangeOrders, items: rangeItems, destinations, start: bounds.start, end: bounds.end, now, label: bounds.label });
  const intel = buildNotesIntel({ orders, items, products, bundleItems: bundles, shipments, destinations, start: bounds.start, end: bounds.end, todayStart: today.start, todayEnd: today.end, now });

  const k = report.kpis;
  const units = visuals.totals.units;
  console.log(`\nNotes analytics · ${bounds.label} · ${bounds.start.toISOString()} → ${bounds.end.toISOString()}`);
  console.log(`events read ${events.length} · paid orders all-time ${orders.length}`);
  check("every behaviour event in range is read (no silent cap)", events.length <= MAX_NOTES_EVENTS, `${events.length}`);
  console.log(`Visitors ${k.visitors} · Product viewers ${k.productViewers} · Add to cart ${k.addToCarts} · Checkout ${k.checkouts}`);
  console.log(`Paid orders ${k.paidOrders} · Paid units ${units} · Revenue ${formatPaise(k.revenuePaise)} · AOV ${k.aovPaise == null ? "—" : formatPaise(k.aovPaise)} · Conversion ${k.conversionPct ?? "—"}%`);

  console.log("\nReconciliation");
  const last = (metric: "orders" | "revenue" | "units") => timelineSeries(visuals.points, intel.fulfillment, metric, "cumulative").at(-1)?.valueRaw ?? 0;
  check("cumulative paid orders = Paid orders", last("orders") === k.paidOrders, `${last("orders")} vs ${k.paidOrders}`);
  check("cumulative revenue = Revenue", last("revenue") === k.revenuePaise, `${formatPaise(last("revenue"))} vs ${formatPaise(k.revenuePaise)}`);
  check("cumulative units = Paid units", last("units") === units, `${last("units")} vs ${units}`);
  const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
  check("intel cohort orders = Paid orders", intel.cohort.orders === k.paidOrders, `${intel.cohort.orders} vs ${k.paidOrders}`);
  check("state orders = Paid orders", sum(intel.states, (r) => r.orders) === k.paidOrders, `${sum(intel.states, (r) => r.orders)}`);
  check("state revenue = Revenue", sum(intel.states, (r) => r.revenuePaise) === k.revenuePaise, formatPaise(sum(intel.states, (r) => r.revenuePaise)));
  check("state units = Paid units", sum(intel.states, (r) => r.units) === units, `${sum(intel.states, (r) => r.units)}`);
  const bundleSold = intel.subjects.length > 0 && items.some((i) => products.find((p) => p.id === i.product_id)?.kind === "bundle");
  check(`subject units = Paid units${bundleSold ? " (bundles expand to component books)" : ""}`, bundleSold || sum(intel.subjects, (r) => r.units) === units, `${sum(intel.subjects, (r) => r.units)}`);
  check("subject net revenue = captured merchandise (total − customer shipping)", sum(intel.subjects, (r) => r.netRevenuePaise) === intel.cohort.merchandisePaise, `${formatPaise(sum(intel.subjects, (r) => r.netRevenuePaise))} vs ${formatPaise(intel.cohort.merchandisePaise)}`);
  check("state rated shipments = global rate coverage", sum(intel.states, (r) => r.count) === intel.shipping.count, `${sum(intel.states, (r) => r.count)} vs ${intel.shipping.count}`);
  check("subject orders ≥ 1 per subject and ≤ Paid orders", intel.subjects.every((r) => r.orders >= 1 && r.orders <= k.paidOrders));
  const numbers = JSON.stringify(intel).match(/NaN|Infinity/g);
  check("no NaN / Infinity in intelligence output", !numbers);

  // Same helper as the Notes Orders tile, all-time population.
  const byOrder = new Map<string, ShipmentRowLike[]>();
  for (const row of [...shipments].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) byOrder.set(row.order_id, [...(byOrder.get(row.order_id) || []), row]);
  const tile = shippingRateStats(
    orders.map((o) => ({ id: o.id, status: o.status, paid_at: o.paid_at, qa: isQaNotesOrder({ attribution_source: o.attribution_source ?? null, attribution_json: (o.attribution_json || null) as StoredNotesAttribution | null, promo_code: o.promo_code ?? null }) })),
    byOrder,
  );

  console.log("\nSubjects");
  for (const s of intel.subjects) console.log(`  ${s.label.padEnd(22)} orders ${String(s.orders).padStart(3)} · units ${String(s.units).padStart(3)} · net ${formatPaise(s.netRevenuePaise)}`);
  console.log("\nStates");
  for (const s of intel.states) console.log(`  ${s.name.padEnd(28)} orders ${String(s.orders).padStart(3)} · units ${String(s.units).padStart(3)} · ${formatPaise(s.revenuePaise).padStart(10)} · rated ${s.count}/${s.shipments} · avg ${s.avgPaise == null ? "—" : formatPaise(s.avgPaise)}`);
  console.log("\nTop cities");
  for (const c of intel.cities.slice(0, 15)) console.log(`  ${`${c.city}, ${c.state}`.padEnd(34)} orders ${String(c.orders).padStart(3)} · units ${String(c.units).padStart(3)} · ${formatPaise(c.revenuePaise).padStart(10)} · avg ${c.avgPaise == null ? "—" : formatPaise(c.avgPaise)} · median ${c.medianPaise == null ? "—" : formatPaise(c.medianPaise)}`);
  const cityKeys = new Map<string, string[]>();
  for (const c of intel.cities) {
    const loose = `${c.city}|${c.state}`.toLowerCase().replace(/[^a-z]/g, "");
    cityKeys.set(loose, [...(cityKeys.get(loose) || []), `${c.city}, ${c.state}`]);
  }
  const dupes = [...cityKeys.values()].filter((v) => v.length > 1);
  check("no city duplicates from case/spacing/punctuation only", dupes.length === 0, dupes.map((d) => d.join(" / ")).join("; "));

  const sh = intel.shipping;
  console.log("\nShipping (booked courier rate, not provider invoice)");
  console.log(`  paid orders ${sh.paidOrders} · canonical shipments ${sh.booked} · with saved rate ${sh.count} · coverage ${sh.count}/${sh.booked}`);
  console.log(`  avg ${sh.avgPaise == null ? "—" : formatPaise(sh.avgPaise)} · median ${sh.medianPaise == null ? "—" : formatPaise(sh.medianPaise)} · min ${sh.minPaise == null ? "—" : formatPaise(sh.minPaise)} · max ${sh.maxPaise == null ? "—" : formatPaise(sh.maxPaise)}`);
  console.log(`  ≤ ₹100 ${sh.atOrUnder100}/${sh.count} · ${sh.atOrUnder100Pct ?? "—"}% · > ₹100 ${sh.over100}/${sh.count} · burden ${sh.avgBurdenPct ?? "—"}% · duplicate AWBs skipped ${sh.duplicateAwbsSkipped}`);
  console.log(`  Orders tile (all-time, same helper): avg ${tile.avg_paise == null ? "—" : formatPaise(tile.avg_paise)} over ${tile.count}, ${tile.unknown} without rate`);
  console.log("  by state (count desc)");
  for (const s of [...intel.states].filter((r) => r.count > 0).sort((a, b) => b.count - a.count)) console.log(`    ${s.name.padEnd(26)} n=${s.count} avg ${formatPaise(s.avgPaise as number)} · median ${formatPaise(s.medianPaise as number)} · ${formatPaise(s.minPaise as number)}–${formatPaise(s.maxPaise as number)} · weight ${s.avgWeightGrams ?? "—"} g · top ${s.topCourier || "—"}`);
  console.log(`  highest average: ${sh.byState.slice(0, 5).map((s) => `${s.name} ${formatPaise(s.avgPaise as number)}`).join(" · ")}`);
  console.log("  by courier");
  for (const c of sh.byCourier) console.log(`    ${c.courier.padEnd(26)} ${c.provider.padEnd(16)} booked ${c.shipments} · rated ${c.count} · avg ${c.avgPaise == null ? "—" : formatPaise(c.avgPaise)} · median ${c.medianPaise == null ? "—" : formatPaise(c.medianPaise)} · ${c.minPaise == null ? "—" : `${formatPaise(c.minPaise)}–${formatPaise(c.maxPaise as number)}`} · picked up ${c.pickedUp} · delivered ${c.delivered}`);

  console.log(`\nRate anomalies (${intel.anomalies.length}) · ${intel.anomalyRule}`);
  for (const a of intel.anomalies) console.log(`  ${a.orderLabel} ${a.city}, ${a.state} · ${a.weightGrams ?? "—"} g (${a.weightBand}) · ${a.courier} · ${formatPaise(a.ratePaise)} vs median ${formatPaise(a.peerMedianPaise)} (+${formatPaise(a.differencePaise)}) · ${a.comparison} peers ${a.peerCount}`);

  console.log("\nFulfillment method");
  const m = intel.methods;
  console.log(`  delivery ${m.delivery.orders} orders · ${m.delivery.units} units · ${formatPaise(m.delivery.revenuePaise)}`);
  console.log(`  academy pickup ${m.pickup.orders} orders · ${m.pickup.units} units · ${formatPaise(m.pickup.revenuePaise)}`);
  check("delivery + pickup orders = paid orders", m.delivery.orders + m.pickup.orders === intel.cohort.orders, `${m.delivery.orders} + ${m.pickup.orders} vs ${intel.cohort.orders}`);
  check("delivery + pickup revenue = revenue", m.delivery.revenuePaise + m.pickup.revenuePaise === intel.cohort.revenuePaise);
  check("delivery + pickup units = paid units", m.delivery.units + m.pickup.units === intel.cohort.units);
  check("shipping coverage context counts delivery orders only", intel.shipping.paidOrders === m.delivery.orders, `${intel.shipping.paidOrders}`);
  console.log(`  pickup ops: ready now ${intel.pickupOps.readyNow} · collected in range ${intel.pickupOps.collectedInRange} · oldest ready ${intel.pickupOps.oldestReadyMs == null ? "—" : `${(intel.pickupOps.oldestReadyMs / 3_600_000).toFixed(1)} h`}`);

  console.log("\nFulfillment");
  console.log(`  events in range: picked up ${intel.fulfillmentTotals.pickedUp} · shipped ${intel.fulfillmentTotals.shipped} · delivered ${intel.fulfillmentTotals.delivered}`);
  console.log(`  today (IST):     picked up ${intel.today.pickedUp} · shipped ${intel.today.shipped} · delivered ${intel.today.delivered}`);
  const statusCount = (statuses: string[]) => orders.filter((o) => statuses.includes(o.status)).length;
  console.log(`  current: packed ${intel.now.packed} · pickup ${intel.now.pickup} · picked up ${statusCount(["PICKED_UP"])} · in transit ${statusCount(["IN_TRANSIT"])} · out for delivery ${intel.now.outForDelivery} · delivered ${statusCount(["DELIVERED"])}`);
}

/**
 * Academy Pickup invariants, read-only. Passes with "No real Academy Pickup orders yet."
 * when none exist. Never reads names, phones, emails or customer locations.
 */
async function notesPickup() {
  const counts = select<{ method: string; n: number }>(`select fulfillment_method as method, count(*)::int as n from public.store_orders group by 1 order by 1`);
  console.log(`Orders by method: ${counts.map((row) => `${row.method} ${row.n}`).join(" · ") || "none"}`);
  const flag = select<{ enabled: boolean; scope: string; kill_switch: boolean }>(`select enabled, scope, kill_switch from public.app_feature_flags where key = 'notes_store_academy_pickup'`);
  check("pickup flag row exists", flag.length === 1, flag[0] ? `enabled=${flag[0].enabled} scope=${flag[0].scope} kill=${flag[0].kill_switch}` : "missing");

  const pickups = select<{
    order_no: string; status: string; shipping_paise: number; has_shipping_address: boolean; has_snapshot: boolean;
    has_ack: boolean; has_location: boolean; has_ready: boolean; has_collected: boolean; paid: boolean;
  }>(`select order_no, status, shipping_paise, shipping_address_id is not null as has_shipping_address,
      pickup_location_snapshot is not null as has_snapshot, pickup_acknowledged_at is not null as has_ack,
      customer_location_snapshot is not null as has_location, ready_for_collection_at is not null as has_ready,
      collected_at is not null as has_collected, paid_at is not null as paid
    from public.store_orders where fulfillment_method = 'ACADEMY_PICKUP' order by placed_at`);
  const courierRows = select<{ shipments: number; sessions: number; options: number; attempts: number }>(`select
      (select count(*)::int from public.store_shipments s join public.store_orders o on o.id = s.order_id where o.fulfillment_method = 'ACADEMY_PICKUP') as shipments,
      (select count(*)::int from public.store_courier_quote_sessions s join public.store_orders o on o.id = s.order_id where o.fulfillment_method = 'ACADEMY_PICKUP') as sessions,
      (select count(*)::int from public.store_courier_quote_options s join public.store_orders o on o.id = s.order_id where o.fulfillment_method = 'ACADEMY_PICKUP') as options,
      (select count(*)::int from public.store_courier_booking_attempts s join public.store_orders o on o.id = s.order_id where o.fulfillment_method = 'ACADEMY_PICKUP') as attempts`)[0];
  const deliveryLeak = select<{ n: number }>(`select count(*)::int as n from public.store_orders where fulfillment_method = 'DELIVERY'
      and (status in ('READY_FOR_COLLECTION','COLLECTED') or pickup_location_code is not null or pickup_location_snapshot is not null
        or pickup_acknowledged_at is not null or ready_for_collection_at is not null or collected_at is not null)`)[0];
  check("no delivery order carries collection status or pickup metadata", deliveryLeak.n === 0, String(deliveryLeak.n));
  check("pickup orders have zero courier shipments", courierRows.shipments === 0, String(courierRows.shipments));
  check("pickup orders have zero courier quote sessions", courierRows.sessions === 0, String(courierRows.sessions));
  check("pickup orders have zero courier quote options", courierRows.options === 0, String(courierRows.options));
  check("pickup orders have zero courier booking attempts", courierRows.attempts === 0, String(courierRows.attempts));

  if (!pickups.length) {
    console.log("PASS  No real Academy Pickup orders yet.");
    return;
  }
  const deliveryOnly = new Set(["PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "REATTEMPT_REQUESTED", "RTO_INITIATED", "RTO_IN_TRANSIT", "RTO_DELIVERED", "RETURN_PICKUP_SCHEDULED", "RETURN_IN_TRANSIT"]);
  const bad = (label: string, rows: typeof pickups) => check(label, rows.length === 0, rows.map((row) => row.order_no).join(", ") || "0");
  bad("pickup shipping charge is zero", pickups.filter((row) => Number(row.shipping_paise) !== 0));
  bad("pickup has no shipping address", pickups.filter((row) => row.has_shipping_address));
  bad("pickup snapshot frozen", pickups.filter((row) => !row.has_snapshot));
  bad("pickup acknowledgement recorded", pickups.filter((row) => !row.has_ack));
  bad("pickup customer location present", pickups.filter((row) => !row.has_location));
  bad("pickup never in a courier status", pickups.filter((row) => deliveryOnly.has(row.status)));
  bad("READY_FOR_COLLECTION has ready time", pickups.filter((row) => row.status === "READY_FOR_COLLECTION" && !row.has_ready));
  bad("COLLECTED has ready and collected times", pickups.filter((row) => row.status === "COLLECTED" && (!row.has_ready || !row.has_collected)));
  const paid = pickups.filter((row) => row.paid && !["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED"].includes(row.status));
  const invoiced = select<{ order_no: string; status: string }>(`select o.order_no, i.status from public.store_invoices i join public.store_orders o on o.id = i.order_id where o.fulfillment_method = 'ACADEMY_PICKUP'`);
  const invoiceBy = new Map(invoiced.map((row) => [row.order_no, row.status]));
  check("every paid pickup order has an invoice row", paid.every((row) => invoiceBy.has(row.order_no)), paid.filter((row) => !invoiceBy.has(row.order_no)).map((row) => row.order_no).join(", ") || `${paid.length} paid`);
  const collected = pickups.filter((row) => row.status === "COLLECTED").map((row) => row.order_no);
  if (collected.length) {
    const events = select<{ order_no: string; actor: boolean }>(`select o.order_no, e.actor_name is not null as actor from public.store_order_events e join public.store_orders o on o.id = e.order_id where e.event = 'collected' and o.fulfillment_method = 'ACADEMY_PICKUP'`);
    const withActor = new Set(events.filter((row) => row.actor).map((row) => row.order_no));
    check("every collected order has a staff collection event", collected.every((no) => withActor.has(no)), collected.filter((no) => !withActor.has(no)).join(", ") || `${collected.length}`);
  }
  const byStatus = new Map<string, number>();
  for (const row of pickups) byStatus.set(row.status, (byStatus.get(row.status) || 0) + 1);
  console.log(`Pickup orders ${pickups.length}: ${[...byStatus].map(([status, n]) => `${status} ${n}`).join(" · ")}`);
}

/**
 * Courier pickup lifecycle invariants, read-only. Detects the state-machine drift that
 * leaves an order PACKED while its active courier shipment already carries an AWB (and,
 * for Shiprocket, a generated pickup). Reports each affected order by order_no only and
 * the safe target status {@link planLocalRepair} would propose. Reads no name/phone/address.
 */
async function notesPickup2_courier() {
  type Row = {
    order_no: string; order_status: string; provider: CourierProvider; awb: string | null;
    shipment_status: string | null; pickup_state: string | null; tracking_status: string | null;
    pickup_status: string | null; pickup_scheduled_at: string | null; created_at: string | null;
  };
  // Active (non-cancelled) courier shipments for DELIVERY orders that have not yet reached possession.
  const rows = select<Row>(`select o.order_no, o.status as order_status, s.provider, s.awb,
      s.status as shipment_status, s.pickup_state, s.provider_payload->>'tracking_status' as tracking_status,
      s.provider_payload->>'pickup_status' as pickup_status, s.pickup_scheduled_at, s.created_at
    from public.store_orders o join public.store_shipments s on s.order_id = o.id
    where o.fulfillment_method = 'DELIVERY' and s.status <> 'cancelled'
      and o.status in ('PAID','PROCESSING','PACKED','READY_FOR_PICKUP','PICKUP_SCHEDULED')
    order by o.order_no`);

  console.log(`Active courier shipments on pre-possession delivery orders: ${rows.length}`);

  // (1/2) Drift: PACKED while the active shipment already holds an AWB (booked) or a confirmed pickup.
  const drift: { order_no: string; from: string; to: string | null; basis: string; signal: string }[] = [];
  for (const r of rows) {
    if (!r.awb) continue;
    const plan = planLocalRepair(
      { status: r.order_status },
      { provider: r.provider, awb: r.awb, shipmentStatus: r.shipment_status, trackingStatus: r.tracking_status, pickupStatusRaw: r.pickup_status, pickupState: (r.pickup_state as never) ?? "NOT_REQUESTED", active: true },
    );
    if (plan.changed) drift.push({ order_no: r.order_no, from: r.order_status, to: plan.orderStatus, basis: plan.basis, signal: r.tracking_status || r.pickup_status || "—" });
  }
  check("no order is PACKED/behind while its active shipment already holds an AWB", drift.length === 0, `${drift.length} drifted`);
  if (drift.length) {
    console.log("\nState-machine drift (safe local repair proposed — read-only, not applied here):");
    for (const d of drift) console.log(`  ${d.order_no}  ${d.from} → ${d.to}  [${d.basis}, carrier: ${d.signal}]`);
  }

  const byOrder = new Map<string, Row[]>();
  for (const r of rows) byOrder.set(r.order_no, [...(byOrder.get(r.order_no) || []), r]);

  // (3) PICKUP_SCHEDULED must have an active shipment.
  const scheduledNoShipment = select<{ order_no: string }>(`select o.order_no from public.store_orders o
    where o.fulfillment_method = 'DELIVERY' and o.status = 'PICKUP_SCHEDULED'
      and not exists (select 1 from public.store_shipments s where s.order_id = o.id and s.status <> 'cancelled' and s.status <> 'failed')
    order by o.order_no`);
  check("no PICKUP_SCHEDULED order without an active shipment", scheduledNoShipment.length === 0, scheduledNoShipment.map((r) => r.order_no).join(", ") || "0");

  // (4) PICKUP_SCHEDULED must have scheduling evidence (pickup_state SCHEDULED, a scheduled time, or carrier wording).
  const schedNoEvidence = rows.filter((r) => r.order_status === "PICKUP_SCHEDULED").filter((r) => {
    const sched = r.pickup_state === "SCHEDULED" || Boolean(r.pickup_scheduled_at);
    const carrier = `${r.tracking_status || ""} ${r.pickup_status || ""}`.toLowerCase();
    const wording = carrier.includes("pickup scheduled") || carrier.includes("pickup generated") || carrier.includes("pickup confirmed") || carrier.includes("out for pickup") || carrier.includes("picked");
    return !sched && !wording;
  });
  check("every PICKUP_SCHEDULED order has scheduling evidence", schedNoEvidence.length === 0, schedNoEvidence.map((r) => r.order_no).join(", ") || "0");

  // (5) At most one active courier shipment per delivery order.
  const multi = select<{ order_no: string; n: number }>(`select o.order_no, count(*)::int as n
    from public.store_orders o join public.store_shipments s on s.order_id = o.id
    where o.fulfillment_method = 'DELIVERY' and s.status not in ('cancelled','failed') and s.provider <> 'manual'
    group by o.order_no having count(*) > 1 order by o.order_no`);
  check("at most one active courier shipment per delivery order", multi.length === 0, multi.map((m) => `${m.order_no}×${m.n}`).join(", ") || "0");

  // (6) A cancelled shipment must not still carry a live pickup_state.
  const cancelledLivePickup = select<{ order_no: string; pickup_state: string }>(`select o.order_no, s.pickup_state
    from public.store_orders o join public.store_shipments s on s.order_id = o.id
    where s.status = 'cancelled' and s.pickup_state in ('REQUESTED','SCHEDULED') order by o.order_no`);
  check("no cancelled shipment still marked REQUESTED/SCHEDULED", cancelledLivePickup.length === 0, cancelledLivePickup.map((r) => r.order_no).join(", ") || "0");

  // (7) Academy Pickup orders must never have a courier shipment.
  const pickupShipments = select<{ order_no: string }>(`select distinct o.order_no from public.store_orders o
    join public.store_shipments s on s.order_id = o.id where o.fulfillment_method = 'ACADEMY_PICKUP' order by o.order_no`);
  check("no Academy Pickup order has a courier shipment", pickupShipments.length === 0, pickupShipments.map((r) => r.order_no).join(", ") || "0");

  // (8) A superseded (cancelled) shipment must not be the reason an order sits in a pickup state.
  const supersededDriving = select<{ order_no: string }>(`select o.order_no from public.store_orders o
    where o.fulfillment_method = 'DELIVERY' and o.status in ('READY_FOR_PICKUP','PICKUP_SCHEDULED')
      and exists (select 1 from public.store_shipments s where s.order_id = o.id and s.status = 'cancelled')
      and not exists (select 1 from public.store_shipments s where s.order_id = o.id and s.status not in ('cancelled','failed'))
    order by o.order_no`);
  check("no order driven into a pickup state by a superseded shipment", supersededDriving.length === 0, supersededDriving.map((r) => r.order_no).join(", ") || "0");

  // (9) New post-release bookings must carry a pickup_state (not left at the NOT_REQUESTED default).
  const cutoff = process.env.COURIER_PICKUP_RELEASE_AT;
  if (cutoff) {
    const missingState = rows.filter((r) => r.awb && r.created_at && r.created_at >= cutoff && (r.pickup_state ?? "NOT_REQUESTED") === "NOT_REQUESTED" && r.order_status === "PICKUP_SCHEDULED");
    check(`new bookings since ${cutoff} carry a pickup_state`, missingState.length === 0, missingState.map((r) => r.order_no).join(", ") || "0");
  } else {
    console.log("INFO  set COURIER_PICKUP_RELEASE_AT to also assert new post-release bookings carry a pickup_state");
  }
}

async function main() {
  guard();
  const [suite, range = "30d"] = process.argv.slice(2);
  if (suite === "notes-pickup") {
    await notesPickup();
  } else if (suite === "courier-pickup") {
    await notesPickup2_courier();
  } else if (suite === "notes-analytics") {
    await notesAnalytics(range as NotesRangeKey);
  } else {
    throw new Error("Usage: release:verify-data -- notes-analytics [today|yesterday|7d|30d|month] | notes-pickup | courier-pickup");
  }
  console.log(`\n${failed ? "FAILED" : "ALL INVARIANTS PASS"}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
