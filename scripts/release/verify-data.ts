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
  const rangeOrders = select<NotesOrderFact>(`select id, status, total_paise, discount_paise, paid_at, promo_code, attribution_source, attribution_platform, attribution_json, shipping_address_id
    from public.store_orders where paid_at is not null and paid_at >= ${from} and paid_at < ${to} order by paid_at asc, id asc`);
  const rangeItems = select<NotesItemFact>(`select order_id, product_id, name_snapshot, sku_snapshot, line_total_paise, qty
    from public.store_order_items where order_id in (${list(rangeOrders.map((o) => o.id))})`);

  // ---- notesIntelLoad.loadNotesIntel (intelligence sections)
  const orders = select<IntelOrder>(`select id, order_no, status, total_paise, shipping_paise, discount_paise, paid_at, shipped_at, delivered_at, shipping_address_id, promo_code, attribution_source, attribution_json
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
  const destinations: NotesDestination[] = orders.map((o) => destinationForOrder(o.id, snapBy.get(o.id), o.shipping_address_id ? addrBy.get(o.shipping_address_id) : null));

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

  console.log("\nFulfillment");
  console.log(`  events in range: picked up ${intel.fulfillmentTotals.pickedUp} · shipped ${intel.fulfillmentTotals.shipped} · delivered ${intel.fulfillmentTotals.delivered}`);
  console.log(`  today (IST):     picked up ${intel.today.pickedUp} · shipped ${intel.today.shipped} · delivered ${intel.today.delivered}`);
  const statusCount = (statuses: string[]) => orders.filter((o) => statuses.includes(o.status)).length;
  console.log(`  current: packed ${intel.now.packed} · pickup ${intel.now.pickup} · picked up ${statusCount(["PICKED_UP"])} · in transit ${statusCount(["IN_TRANSIT"])} · out for delivery ${intel.now.outForDelivery} · delivered ${statusCount(["DELIVERED"])}`);
}

async function main() {
  guard();
  const [suite, range = "30d"] = process.argv.slice(2);
  if (suite !== "notes-analytics") throw new Error("Usage: release:verify-data -- notes-analytics [today|yesterday|7d|30d|month]");
  await notesAnalytics(range as NotesRangeKey);
  console.log(`\n${failed ? "FAILED" : "ALL INVARIANTS PASS"}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
