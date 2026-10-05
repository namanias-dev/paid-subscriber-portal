#!/usr/bin/env node
/**
 * Academy Pickup database invariants, executed against a throwaway in-process Postgres (PGlite).
 * Never connects to Supabase.
 *
 *   PGLITE_MODULE=/abs/path/node_modules/@electric-sql/pglite/dist/index.js \
 *     node scripts/qa/notes-pickup-sql.mjs
 *
 * Loads the real store migrations, seeds historical delivery orders in every status, applies
 * supabase/migrations/2026-10-05-notes-store-academy-pickup.sql, then checks every rule
 * table-driven. Exits 1 on any failure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modPath = process.env.PGLITE_MODULE;
if (!modPath) {
  console.error("Set PGLITE_MODULE to @electric-sql/pglite/dist/index.js (install it outside the repo).");
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(modPath).href);

const ROOT = new URL("../..", import.meta.url).pathname;
// PGlite has no pgcrypto; gen_random_uuid() is core since Postgres 13.
const MIG = (name) => readFileSync(join(ROOT, "supabase/migrations", name), "utf8")
  .replace(/create extension if not exists "?pgcrypto"?[^;]*;/gi, "");

const ALL_STATUSES = [
  "PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "PAYMENT_CONFIRMED", "ORDER_CONFIRMED",
  "PROCESSING", "PRINTING", "QUALITY_CHECK", "READY_TO_PACK", "PACKED", "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED",
  "REATTEMPT_REQUESTED", "RTO_INITIATED", "RTO_IN_TRANSIT", "RTO_DELIVERED", "CANCEL_REQUESTED",
  "CANCELLED", "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_PICKUP_SCHEDULED", "RETURN_IN_TRANSIT",
  "RETURN_RECEIVED", "REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED",
];
const COLLECTION = ["READY_FOR_COLLECTION", "COLLECTED"];
const DELIVERY_ONLY = [
  "PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY",
  "DELIVERED", "DELIVERY_FAILED", "REATTEMPT_REQUESTED", "RTO_INITIATED", "RTO_IN_TRANSIT",
  "RTO_DELIVERED", "RETURN_PICKUP_SCHEDULED", "RETURN_IN_TRANSIT",
];

const db = new PGlite();
let failures = 0;
const ok = (msg) => console.log(`✔ ${msg}`);
const bad = (msg) => { failures += 1; console.log(`✖ ${msg}`); };

async function expectOk(sql, params, label) {
  try { await db.query(sql, params); ok(label); } catch (e) { bad(`${label}: ${e.message}`); }
}
async function expectFail(sql, params, label) {
  try { await db.query(sql, params); bad(`${label}: was accepted`); } catch { ok(label); }
}

// Supabase roles/objects the migrations reference.
await db.exec(`
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
  create table public.app_feature_flags (key text primary key, enabled boolean not null default false,
    scope text not null default 'off', kill_switch boolean not null default false,
    meta jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
`);
for (const name of [
  "2026-09-16-notes-store-1a-schema.sql",
  "2026-09-19-notes-store-tracking-token-hash.sql",
  "2026-09-21-notes-store-offers.sql",
  "2026-09-24-notes-store-auto-fulfillment.sql",
  "2026-09-27-notes-checkout-leads.sql",
  "2026-09-27-notes-delivery-address.sql",
  "2026-10-04-notes-store-courier-quote-history.sql",
]) {
  try { await db.exec(MIG(name)); } catch (e) { console.error(`setup ${name}: ${e.message}`); process.exit(2); }
}

// Historical orders: one per existing status, written before the pickup migration exists.
for (const [i, status] of ALL_STATUSES.entries()) {
  await db.query(
    `insert into store_orders (id, order_no, status, customer_name, phone, shipping_paise, total_paise)
     values (gen_random_uuid(), $1, $2, 'Hist', '9876543210', 5900, 255900)`,
    [`NIAS-N-H-${i}`, status],
  );
}
const before = (await db.query(`select id, status, shipping_paise, total_paise from store_orders order by order_no`)).rows;
await db.query(`insert into store_shipments (order_id, status) select id, 'created' from store_orders where status = 'IN_TRANSIT'`);

const t0 = Date.now();
await db.exec(MIG("2026-10-05-notes-store-academy-pickup.sql"));
ok(`migration applied (${Date.now() - t0} ms)`);
await db.exec(MIG("2026-10-05-notes-store-academy-pickup.sql"));
ok("migration is idempotent (applied twice)");

const after = (await db.query(`select id, status, shipping_paise, total_paise, fulfillment_method from store_orders where order_no like 'NIAS-N-H-%' order by order_no`)).rows;
if (after.every((r) => r.fulfillment_method === "DELIVERY")) ok(`${after.length} historical orders default to DELIVERY`);
else bad("historical orders not all DELIVERY");
if (JSON.stringify(after.map(({ fulfillment_method, ...r }) => r)) === JSON.stringify(before)) ok("historical status/money unchanged");
else bad("historical rows changed");
const flag = (await db.query(`select enabled, scope from app_feature_flags where key = 'notes_store_academy_pickup'`)).rows[0];
if (flag && flag.enabled === false && flag.scope === "off") ok("flag row inserted disabled"); else bad("flag row missing or enabled");

const SNAP = `'{"code":"CHD_17C","name":"Naman Sharma IAS Academy"}'::jsonb`;
const LOC = `'{"pincode":"110001","city":"New Delhi","state":"Delhi"}'::jsonb`;
async function pickup(no, status = "PAYMENT_PENDING", extra = "") {
  const r = await db.query(
    `insert into store_orders (order_no, status, customer_name, phone, shipping_paise, total_paise, fulfillment_method,
       pickup_location_code, pickup_location_snapshot, pickup_acknowledged_at, customer_location_snapshot ${extra ? ", " + extra.split("=")[0] : ""})
     values ($1, $2, 'Pick', '9876500000', 0, 250000, 'ACADEMY_PICKUP', 'CHD_17C', ${SNAP}, now(), ${LOC} ${extra ? ", " + extra.split("=")[1] : ""})
     returning id`,
    [no, status],
  );
  return r.rows[0].id;
}

// Status × method table.
for (const status of [...ALL_STATUSES, ...COLLECTION]) {
  const times = status === "READY_FOR_COLLECTION" ? "ready_for_collection_at=now()"
    : status === "COLLECTED" ? "ready_for_collection_at, collected_at=now(), now()" : "";
  const allowedPickup = !DELIVERY_ONLY.includes(status);
  const sqlPickup = times
    ? `insert into store_orders (order_no, status, customer_name, phone, shipping_paise, total_paise, fulfillment_method, pickup_location_code, pickup_location_snapshot, pickup_acknowledged_at, customer_location_snapshot, ${times.split("=")[0]}) values ($1, $2, 'P', '9876500000', 0, 1, 'ACADEMY_PICKUP', 'CHD_17C', ${SNAP}, now(), ${LOC}, ${times.split("=")[1]})`
    : `insert into store_orders (order_no, status, customer_name, phone, shipping_paise, total_paise, fulfillment_method, pickup_location_code, pickup_location_snapshot, pickup_acknowledged_at, customer_location_snapshot) values ($1, $2, 'P', '9876500000', 0, 1, 'ACADEMY_PICKUP', 'CHD_17C', ${SNAP}, now(), ${LOC})`;
  if (allowedPickup) await expectOk(sqlPickup, [`P-${status}`, status], `pickup may be ${status}`);
  else await expectFail(sqlPickup, [`P-${status}`, status], `pickup may NOT be ${status}`);
  const sqlDelivery = `insert into store_orders (order_no, status, customer_name, phone, shipping_paise, total_paise ${times ? ", " + times.split("=")[0] : ""}) values ($1, $2, 'D', '9876511111', 5900, 1 ${times ? ", " + times.split("=")[1] : ""})`;
  if (COLLECTION.includes(status)) await expectFail(sqlDelivery, [`D-${status}`, status], `delivery may NOT be ${status}`);
  else await expectOk(sqlDelivery, [`D-${status}`, status], `delivery may be ${status}`);
}

// Pickup shape.
const base = `insert into store_orders (order_no, status, customer_name, phone, shipping_paise, total_paise, fulfillment_method, pickup_location_code, pickup_location_snapshot, pickup_acknowledged_at, customer_location_snapshot, shipping_address_id)`;
await expectFail(`${base} values ('X1','PAYMENT_PENDING','a','9876500000',4900,1,'ACADEMY_PICKUP','CHD_17C',${SNAP},now(),${LOC},null)`, [], "pickup with shipping > 0 refused");
await db.query(`insert into store_addresses (id, name, phone, line1, city, state, pincode) values ('22222222-2222-4222-8222-222222222222','a','1','l','c','s','110001')`);
await expectFail(`${base} values ('X2','PAYMENT_PENDING','a','9876500000',0,1,'ACADEMY_PICKUP','CHD_17C',${SNAP},now(),${LOC},'22222222-2222-4222-8222-222222222222')`, [], "pickup with a shipping address refused");
await expectFail(`${base} values ('X3','PAYMENT_PENDING','a','9876500000',0,1,'ACADEMY_PICKUP','CHD_17C',null,now(),${LOC},null)`, [], "pickup without snapshot refused");
await expectFail(`${base} values ('X4','PAYMENT_PENDING','a','9876500000',0,1,'ACADEMY_PICKUP','CHD_17C',${SNAP},null,${LOC},null)`, [], "pickup without acknowledgement refused");
await expectFail(`${base} values ('X5','PAYMENT_PENDING','a','9876500000',0,1,'ACADEMY_PICKUP','CHD_17C',${SNAP},now(),null,null)`, [], "pickup without customer location refused");
await expectFail(`insert into store_orders (order_no, status, customer_name, phone, fulfillment_method) values ('X6','PAYMENT_PENDING','a','9876500000','COURIER')`, [], "unknown method refused");
await expectFail(`insert into store_orders (order_no, status, customer_name, phone, pickup_location_code) values ('X7','PAYMENT_PENDING','a','9876500000','CHD_17C')`, [], "delivery with pickup metadata refused");
await expectFail(`insert into store_orders (order_no, status, customer_name, phone, shipping_paise, total_paise, fulfillment_method, pickup_location_code, pickup_location_snapshot, pickup_acknowledged_at, customer_location_snapshot) values ('X8','READY_FOR_COLLECTION','a','9876500000',0,1,'ACADEMY_PICKUP','CHD_17C',${SNAP},now(),${LOC})`, [], "READY_FOR_COLLECTION without ready time refused");

// Immutability from creation (not only after payment).
const pid = await pickup("IMM-1");
await expectFail(`update store_orders set fulfillment_method = 'DELIVERY' where id = $1`, [pid], "PAYMENT_PENDING pickup cannot switch to DELIVERY");
const hid = after.find((r) => r.status === "PAYMENT_PENDING").id;
await expectFail(`update store_orders set fulfillment_method = 'ACADEMY_PICKUP' where id = $1`, [hid], "PAYMENT_PENDING delivery cannot switch to ACADEMY_PICKUP");
await expectFail(`update store_orders set pickup_location_snapshot = '{"code":"X"}'::jsonb where id = $1`, [pid], "pickup snapshot immutable");
await expectFail(`update store_orders set customer_location_snapshot = '{"state":"Maharashtra"}'::jsonb where id = $1`, [pid], "customer location immutable");
await expectFail(`update store_orders set pickup_acknowledged_at = now() - interval '1 day' where id = $1`, [pid], "acknowledgement time immutable");
await expectOk(`update store_orders set status = 'ORDER_CONFIRMED', paid_at = now() where id = $1`, [pid], "pickup can be captured (status/paid_at update)");
await expectOk(`update store_orders set status = 'PROCESSING' where id = $1`, [pid], "pickup → PROCESSING");
await expectOk(`update store_orders set status = 'PRINTING' where id = $1`, [pid], "pickup → PRINTING");
await expectFail(`update store_orders set status = 'PACKED' where id = $1`, [pid], "pickup PRINTING → PACKED refused");
await expectFail(`update store_orders set status = 'READY_FOR_COLLECTION' where id = $1`, [pid], "ready without timestamp refused");
await expectOk(`update store_orders set status = 'READY_FOR_COLLECTION', ready_for_collection_at = now() where id = $1`, [pid], "pickup → READY_FOR_COLLECTION with time");
await expectFail(`update store_orders set status = 'IN_TRANSIT' where id = $1`, [pid], "pickup ready → IN_TRANSIT refused");
await expectFail(`update store_orders set status = 'COLLECTED' where id = $1`, [pid], "collected without time refused");
await expectOk(`update store_orders set status = 'COLLECTED', collected_at = now() where id = $1`, [pid], "pickup → COLLECTED with time");
await expectOk(`update store_orders set status = 'REFUNDED' where id = $1`, [pid], "pickup can still be REFUNDED");
const did = after.find((r) => r.status === "PRINTING").id;
await expectFail(`update store_orders set status = 'READY_FOR_COLLECTION', ready_for_collection_at = now() where id = $1`, [did], "delivery PRINTING → READY_FOR_COLLECTION refused");

// Courier backstop: insert and re-link on every courier table.
const p2 = await pickup("COURIER-1", "PACKED".replace("PACKED", "PRINTING"));
await expectFail(`insert into store_shipments (order_id, status) values ($1, 'pending')`, [p2], "shipment insert for pickup refused");
const sid = (await db.query(`select id from store_shipments limit 1`)).rows[0].id;
await expectFail(`update store_shipments set order_id = $1 where id = $2`, [p2, sid], "shipment re-link to pickup refused");
const deliveryOrder = after.find((r) => r.status === "PACKED").id;
await expectOk(`insert into store_shipments (order_id, status) values ($1, 'pending')`, [deliveryOrder], "shipment insert for delivery still allowed");
const sessionCols = (await db.query(`select column_name, is_nullable, column_default from information_schema.columns where table_name='store_courier_quote_sessions' order by ordinal_position`)).rows;
const required = sessionCols.filter((c) => c.is_nullable === "NO" && c.column_default == null && c.column_name !== "order_id").map((c) => c.column_name);
const TYPES = new Map((await db.query(`select table_name || '.' || column_name k, data_type from information_schema.columns where table_name like 'store_courier_%'`)).rows.map((r) => [r.k.split(".")[1], r.data_type]));
const fill = (cols) => cols.map((c) => {
  const t = TYPES.get(c) || "text";
  if (t === "integer" || t === "bigint" || t === "numeric") return "1";
  if (t === "boolean") return "true";
  if (t.startsWith("timestamp")) return "now()";
  if (t === "jsonb" || t === "json") return "'{}'::jsonb";
  if (t === "uuid") return "gen_random_uuid()";
  if (t === "ARRAY") return "'{}'";
  return "'x'";
});
async function insertSession(orderId) {
  const cols = ["order_id", ...required];
  const vals = ["$1", ...fill(required)];
  return db.query(`insert into store_courier_quote_sessions (${cols.join(",")}) values (${vals.join(",")}) returning id`, [orderId]);
}
try { await insertSession(p2); bad("quote session for pickup accepted"); } catch { ok("quote session insert for pickup refused"); }
let deliverySession;
try { deliverySession = (await insertSession(deliveryOrder)).rows[0].id; ok("quote session for delivery allowed"); } catch (e) { bad(`delivery quote session: ${e.message}`); }
if (deliverySession) {
  await expectFail(`update store_courier_quote_sessions set order_id = $1 where id = $2`, [p2, deliverySession], "quote session re-link to pickup refused");
  const optCols = (await db.query(`select column_name from information_schema.columns where table_name='store_courier_quote_options' and is_nullable='NO' and column_default is null and column_name not in ('order_id','quote_session_id')`)).rows.map((r) => r.column_name);
  const optSql = (orderParam) => `insert into store_courier_quote_options (order_id, quote_session_id, ${optCols.join(",")}) values (${orderParam}, $2, ${fill(optCols).join(",")}) returning id`;
  await expectFail(optSql("$1"), [p2, deliverySession], "quote option for pickup refused");
  let optId;
  try { optId = (await db.query(optSql("$1"), [deliveryOrder, deliverySession])).rows[0].id; ok("quote option for delivery allowed"); } catch (e) { bad(`delivery option: ${e.message}`); }
  if (optId) {
    await expectFail(`update store_courier_quote_options set order_id = $1 where id = $2`, [p2, optId], "quote option re-link to pickup refused");
    const attCols = (await db.query(`select column_name from information_schema.columns where table_name='store_courier_booking_attempts' and is_nullable='NO' and column_default is null and column_name not in ('order_id','quote_session_id','quote_option_id')`)).rows.map((r) => r.column_name);
    const attSql = `insert into store_courier_booking_attempts (order_id, quote_session_id, quote_option_id${attCols.length ? "," + attCols.join(",") : ""}) values ($1, $2, $3${attCols.length ? "," + fill(attCols).join(",") : ""}) returning id`;
    await expectFail(attSql, [p2, deliverySession, optId], "booking attempt for pickup refused");
    let attId;
    try { attId = (await db.query(attSql, [deliveryOrder, deliverySession, optId])).rows[0].id; ok("booking attempt for delivery allowed"); } catch (e) { bad(`delivery attempt: ${e.message}`); }
    if (attId) await expectFail(`update store_courier_booking_attempts set order_id = $1 where id = $2`, [p2, attId], "booking attempt re-link to pickup refused");
  }
}

// Cart + lead draft columns.
await expectOk(`insert into store_carts (status, fulfillment_method) values ('open', 'ACADEMY_PICKUP')`, [], "cart draft ACADEMY_PICKUP accepted");
await expectOk(`insert into store_carts (status) values ('open')`, [], "cart draft null accepted (UI default Delivery)");
await expectFail(`insert into store_carts (status, fulfillment_method) values ('open', 'PICKUP')`, [], "cart draft unknown method refused");
await expectFail(`insert into store_checkout_leads (phone, fulfillment_method) values ('9876500000', 'X')`, [], "lead unknown method refused");

console.log(failures ? `\nFAILED: ${failures}` : "\nALL SQL INVARIANTS PASS");
process.exit(failures ? 1 : 0);
