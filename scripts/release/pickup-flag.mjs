#!/usr/bin/env node
/**
 * Academy Pickup creation flag. See docs/notes-store/ACADEMY_PICKUP.md.
 *
 *   npm run release:pickup-status    read-only: flag row, live app resolution, prechecks
 *   npm run release:pickup-enable    enabled=true, scope='all' for notes_store_academy_pickup only
 *   npm run release:pickup-disable   enabled=false for notes_store_academy_pickup only
 *
 * The SQL is fixed in this file. No argument reaches the database. The only write
 * touches one row of public.app_feature_flags, and enable refuses unless the live app
 * is pickup-aware, every active product is nil-rated, and the kill switch is off.
 * Uses the Supabase CLI login (`--linked`); never reads the service-role key.
 */
import { spawnSync } from "node:child_process";

const PROJECT_REF = "xqwdfyzerzsllqiyzxem";
const SITE = "https://www.namanias.com";
const KEY = "notes_store_academy_pickup";

const SQL = {
  flag: `begin transaction read only; select key, enabled, scope, kill_switch, updated_at from public.app_feature_flags where key = '${KEY}'; rollback;`,
  products: "begin transaction read only; select sku, tax_treatment, tax_rate_bps from public.store_products where is_active = true and archived_at is null order by sku; rollback;",
  schema: `begin transaction read only; select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'store_orders' and column_name in ('fulfillment_method','pickup_location_code','pickup_location_snapshot','pickup_acknowledged_at','customer_location_snapshot','ready_for_collection_at','collected_at'))::int as order_columns,
    (select count(*) from pg_constraint where conname in ('store_orders_fulfillment_method_check','store_orders_status_method_check','store_orders_pickup_shape_check','store_orders_delivery_shape_check','store_orders_collection_times_check') and convalidated)::int as constraints,
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_store_orders_freeze_fulfillment','trg_store_shipments_delivery_only','trg_store_courier_quote_sessions_delivery_only','trg_store_courier_quote_options_delivery_only','trg_store_courier_booking_attempts_delivery_only'))::int as triggers,
    (select count(*) from store_orders)::int as orders,
    (select count(*) from store_orders where fulfillment_method = 'DELIVERY')::int as delivery_orders,
    (select count(*) from store_orders where fulfillment_method = 'ACADEMY_PICKUP')::int as pickup_orders; rollback;`,
  enable: `update public.app_feature_flags set enabled = true, scope = 'all', updated_at = now() where key = '${KEY}' and kill_switch = false returning key, enabled, scope, kill_switch, updated_at;`,
  disable: `update public.app_feature_flags set enabled = false, updated_at = now() where key = '${KEY}' returning key, enabled, scope, kill_switch, updated_at;`,
};

function query(sql) {
  const out = spawnSync("supabase", ["db", "query", "--linked", "--project-ref", PROJECT_REF, "--output-format", "json", sql], { encoding: "utf8", timeout: 120_000 });
  if (out.status !== 0) throw new Error(`supabase db query failed: ${(out.stderr || "").trim().split("\n").pop()}`);
  const parsed = JSON.parse(out.stdout);
  return Array.isArray(parsed) ? parsed : parsed.rows || [];
}

async function liveApp() {
  const version = await fetch(`${SITE}/api/version`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  // GET without a cart cookie: reads the flag, creates nothing.
  const cart = await fetch(`${SITE}/api/notes/cart`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
  return { sha: String(version.version || ""), pickupAware: Boolean(cart.fulfillment), pickupAvailable: cart.fulfillment?.pickup_available === true };
}

function flagRow() {
  const rows = query(SQL.flag);
  if (rows.length !== 1) throw new Error(`expected one ${KEY} row, found ${rows.length}`);
  return rows[0];
}

function show(row) {
  console.log(`  ${row.key}: enabled=${row.enabled} scope=${row.scope} kill_switch=${row.kill_switch} updated_at=${row.updated_at}`);
}

async function status() {
  const row = flagRow();
  show(row);
  const app = await liveApp();
  console.log(`  live ${app.sha} · pickup-aware ${app.pickupAware} · resolves ${app.pickupAvailable ? "ON" : "OFF"} (flag memo up to ~20 s per instance)`);
  const products = query(SQL.products);
  const taxable = products.filter((p) => Number(p.tax_rate_bps) !== 0 || p.tax_treatment === "taxable");
  console.log(`  active products ${products.length} · pickup-eligible ${products.length - taxable.length}${taxable.length ? ` · taxable: ${taxable.map((p) => p.sku).join(", ")}` : ""}`);
  const [schema] = query(SQL.schema);
  const schemaOk = schema.order_columns === 7 && schema.constraints === 5 && schema.triggers === 5;
  console.log(`  schema columns ${schema.order_columns}/7 · constraints ${schema.constraints}/5 · triggers ${schema.triggers}/5 · ${schemaOk ? "OK" : "MISSING"}`);
  console.log(`  orders ${schema.orders} · delivery ${schema.delivery_orders} · pickup ${schema.pickup_orders}`);
  const { activePickupLocation } = await import("../../lib/store/pickupLocation.ts");
  const location = activePickupLocation();
  console.log(`  location ${location.ok ? `OK ${location.fingerprint}` : `INVALID ${location.problems.join(",")}`}`);
  return { row, app, taxable, schemaOk, locationOk: location.ok };
}

async function enable() {
  const { row, app, taxable, schemaOk, locationOk } = await status();
  if (!app.pickupAware) throw new Error("live app is not pickup-aware; deploy Release B or later first");
  if (!schemaOk) throw new Error("pickup columns, constraints or triggers are missing; apply the migration first");
  if (!locationOk) throw new Error("pickup location config is invalid");
  if (row.kill_switch) throw new Error("kill_switch is on; refusing to enable");
  if (taxable.length) throw new Error("taxable active products would be refused at pickup checkout; resolve the tax policy first");
  const written = query(SQL.enable);
  if (written.length !== 1) throw new Error(`update matched ${written.length} rows`);
  const back = flagRow();
  show(back);
  const pass = back.enabled === true && back.scope === "all" && back.kill_switch === false;
  console.log(pass ? "✔ enabled (read back)" : "✖ unexpected state after enable");
  if (!pass) process.exitCode = 1;
}

async function disable() {
  const written = query(SQL.disable);
  if (written.length !== 1) throw new Error(`update matched ${written.length} rows`);
  const back = flagRow();
  show(back);
  const pass = back.enabled === false;
  console.log(pass ? "✔ disabled (read back); existing pickup orders stay operable" : "✖ unexpected state after disable");
  if (!pass) process.exitCode = 1;
}

const commands = { status, enable, disable };
const command = process.argv[2];
if (!commands[command] || process.argv.length > 3) {
  console.error("usage: pickup-flag.mjs status|enable|disable (no other arguments)");
  process.exit(2);
}
commands[command]().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});
