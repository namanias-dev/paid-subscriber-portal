import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildOrderOps,
  latestTracking,
  liveShipment,
  packageLinesFrom,
  pickupWhen,
  resolvePackageDisplay,
  savedCourierRatePaise,
  shippingRateStats,
  type OrderOpsShipment,
  type ShipmentRowLike,
} from "../../lib/store/orderOps";
import { formatPackageDims, formatPackageWeight, ISSUE_HINT, opsLines, PACKAGE_SOURCE_LABEL } from "../../lib/store/orderOpsDisplay";
import { resolveBookingPackage } from "../../lib/store/shipping/manualBook";
import { stageProgress, TIMELINE } from "../../lib/store/opsBoard";
import { adminStageLabel, PROGRESS, productList } from "../../lib/store/stages";
import { formatAdminWhen } from "../../lib/store/adminConsole";
import { groupMatchesBucket, groupNotesCustomers } from "../../lib/store/customerGroups";

const ROW_FILES = [
  "components/notes/admin/OrderQueue.tsx",
  "components/notes/admin/orders/CustomerViews.tsx",
  "components/notes/admin/orders/OrderOpsCell.tsx",
];

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const PROFILE = { weight_grams: 500, length_mm: 300, width_mm: 250, height_mm: 30 };
const products = new Map([
  ["polity", PROFILE],
  ["economy", PROFILE],
]);
const POLITY = { qty: 1, product_id: "polity", weight_grams_snapshot: 500 };
const ECONOMY = { qty: 1, product_id: "economy", weight_grams_snapshot: 500 };

interface Ship extends ShipmentRowLike {
  courier_name?: string | null;
  provider?: string | null;
  pickup_scheduled_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
}

function ship(partial: Partial<Ship>): Ship {
  return { status: "manifested", awb: "AWB1", courier_name: "Xpressbees Surface", provider: "shiprocket", ...PROFILE, provider_payload: {}, ...partial };
}

/** Same canonical pick as the admin route: newest non-cancelled/failed row that is not waiting for city confirmation. */
function displayShip(rows: Ship[]): OrderOpsShipment | null {
  const row = rows.find((s) => {
    if (s.status === "cancelled" || s.status === "failed") return false;
    const p = (s.provider_payload || {}) as Record<string, unknown>;
    return !(p.city_confirm_required === true && p.destination_accepted !== true && s.awb);
  });
  if (!row) return null;
  const p = (row.provider_payload || {}) as Record<string, string | undefined>;
  return {
    courier: row.courier_name || null,
    awb: row.awb,
    provider: row.provider || null,
    status: row.status,
    pickup_scheduled_at: row.pickup_scheduled_at || null,
    pickup_date: p.pickup_date || null,
    pickup_time: p.pickup_time || null,
    picked_up_at: row.picked_up_at || null,
    delivered_at: row.delivered_at || null,
    tracking_activity: p.tracking_activity || null,
    tracking_event_at: p.tracking_event_at || null,
    rate_paise: savedCourierRatePaise(row.provider_payload),
  };
}

function ops(input: { status: string; rows?: Ship[]; items?: Array<typeof POLITY>; reasons?: string[]; city?: string; state?: string; cityConfirm?: boolean }) {
  const rows = input.rows || [];
  return buildOrderOps({
    status: input.status,
    address: { city: input.city ?? "Delhi", state: input.state ?? "Delhi" },
    ship: displayShip(rows),
    cityConfirm: Boolean(input.cityConfirm),
    reasons: input.reasons || [],
    package: resolvePackageDisplay({ rows, lines: packageLinesFrom(input.items || [POLITY], products) }),
  });
}

test("A/B: preparing and printing show the exact stage and no courier prompt", () => {
  const a = ops({ status: "PROCESSING" });
  assert.equal(a.stage?.label, "Preparing");
  assert.equal(a.courier_not_selected, false);
  assert.equal(opsLines({ status: "PROCESSING", ops: a }).headline, "Preparing notes");
  assert.equal(opsLines({ status: "PROCESSING", ops: a }).rate, null);
  const b = ops({ status: "PRINTING" });
  assert.equal(b.stage?.label, "Printing");
  assert.equal(b.courier_not_selected, false);
  assert.equal(b.package?.source, "PRODUCT_PROFILE");
});

test("C: packed without a shipment says Courier not selected and is not an issue", () => {
  const c = ops({ status: "PACKED", reasons: ["No active shipment"] });
  assert.equal(c.courier_not_selected, true);
  assert.equal(c.courier, null);
  assert.equal(c.rate_paise, null);
  assert.equal(c.issue, null);
  assert.deepEqual(opsLines({ status: "PACKED", ops: c }), { headline: "Courier not selected", rate: null, detail: null, recorded: false, alert: null });
});

test("D/O: mixed order with a saved package shows the order package, not the 500 g profile", () => {
  const saved = ship({ status: "pending", awb: null, provider: "manual", courier_name: null, weight_grams: 1000, length_mm: 320, width_mm: 230, height_mm: 40, provider_payload: { package_source: "STAFF_OVERRIDE" } });
  const d = ops({ status: "PACKED", rows: [saved], items: [POLITY, ECONOMY] });
  assert.equal(d.package?.source, "ORDER_PACKAGE");
  assert.equal(formatPackageWeight(d.package!.weight_grams), "1.0 kg");
  assert.equal(formatPackageDims(d.package!), "32×23×4 cm");
  assert.equal(PACKAGE_SOURCE_LABEL[d.package!.source], "Order package");
  const single = ops({ status: "PACKED", rows: [saved], items: [POLITY] });
  assert.equal(single.package?.weight_grams, 1000, "an order override beats the single-product profile");
});

test("E: mixed order without a saved package is Package required", () => {
  const e = ops({ status: "PACKED", items: [POLITY, ECONOMY], reasons: ["No active shipment"] });
  assert.equal(e.package, null);
  assert.equal(e.issue, "Package required");
  assert.deepEqual(opsLines({ status: "PACKED", ops: e }), {
    headline: "Package required",
    rate: null,
    detail: "Weigh and enter final parcel dimensions",
    recorded: false,
    alert: "package",
  });
  const twoCopies = ops({ status: "PRINTING", items: [{ ...POLITY, qty: 2 }] });
  assert.equal(twoCopies.package, null);
  assert.equal(twoCopies.issue, null, "not actionable before packing");
});

test("F/G: pickup date only stays a date; a provider slot keeps its time", () => {
  const f = ops({ status: "PICKUP_SCHEDULED", rows: [ship({ pickup_scheduled_at: "2026-09-30T00:00:00+00:00", provider_payload: { pickup_date: "2026-09-30", rate_paise: 9372 } })] });
  assert.equal(f.pickup_at, "2026-09-30");
  assert.equal(formatAdminWhen(f.pickup_at), "30 Sep");
  assert.deepEqual(opsLines({ status: "PICKUP_SCHEDULED", ops: f }), { headline: "Xpressbees Surface", rate: "₹93.72", detail: "Pickup 30 Sep", recorded: false, alert: null });
  const unknown = ops({ status: "PICKUP_SCHEDULED", rows: [ship({ provider_payload: { rate_paise: 9372 } })] });
  assert.equal(opsLines({ status: "PICKUP_SCHEDULED", ops: unknown }).detail, "Pickup requested · time unavailable", "no invented pickup time");
  const g = ops({ status: "PICKUP_SCHEDULED", rows: [ship({ provider: "delhivery", courier_name: "Delhivery Surface", provider_payload: { pickup_date: "2026-09-30", pickup_time: "10:00:00", booked_rate_paise: 4568 } })] });
  assert.equal(g.pickup_at, "2026-09-30 10:00");
  assert.equal(formatAdminWhen(g.pickup_at), "30 Sep · 10:00 am");
  assert.equal(g.rate_paise, 4568);
  assert.equal(pickupWhen({ pickup_scheduled_at: "2026-09-30T05:03:20+00:00" }), "2026-09-30", "scheduled_at alone never supplies a time");
  assert.equal(pickupWhen({}), null);
});

test("H: in transit shows courier and booked rate with the Paid concept kept separate", () => {
  const h = ops({
    status: "IN_TRANSIT",
    rows: [ship({ status: "in_transit", picked_up_at: "2026-09-29T06:25:46.67+00:00", provider_payload: { rate_paise: 9372, booked_rate_paise: 9372, tracking_activity: "Departed Delhi hub", tracking_event_at: "2026-09-29 16:12:00" } })],
  });
  assert.equal(h.stage?.label, "In transit");
  assert.equal(h.courier, "Xpressbees Surface");
  assert.equal(h.rate_paise, 9372);
  assert.equal(h.latest_text, "Departed Delhi hub");
  assert.equal(formatAdminWhen(h.latest_at), "29 Sep · 4:12 pm");
  assert.equal(formatAdminWhen(h.picked_up_at), "29 Sep · 11:55 am");
  assert.equal(h.stage?.ariaLabel, "In transit. Stage 7 of 9.");
  assert.equal(h.stage?.position, 7);
  assert.deepEqual(opsLines({ status: "IN_TRANSIT", ops: h }), {
    headline: "Xpressbees Surface",
    rate: "₹93.72",
    detail: "Departed Delhi hub · 29 Sep · 4:12 pm",
    recorded: true,
    alert: null,
  });
});

test("stale pre-pickup provider text is hidden once the courier has the parcel", () => {
  const stage = stageProgress("IN_TRANSIT");
  assert.deepEqual(latestTracking("Pickup attempt failed", "2026-09-28 11:59:33", stage), { text: null, at: null });
  assert.deepEqual(latestTracking("Out for pickup", "2026-09-29 10:57:49", stage), { text: null, at: null });
  assert.deepEqual(latestTracking("NA", "2026-09-28 19:44:00", stageProgress("PICKED_UP")), { text: null, at: null });
  assert.deepEqual(latestTracking("IN_TRANSIT_CODE_7", null, stage), { text: null, at: null });
  assert.deepEqual(latestTracking("In Transit", "2026-09-29 16:10:00", stage), { text: null, at: "2026-09-29 16:10:00" });
  assert.deepEqual(latestTracking("PICKED UP", "2026-09-29 15:57:36", stageProgress("PICKED_UP")), { text: null, at: "2026-09-29 15:57:36" });
});

test("I: out for delivery keeps the provider event time", () => {
  const i = ops({ status: "OUT_FOR_DELIVERY", rows: [ship({ status: "out_for_delivery", provider_payload: { rate_paise: 9372, tracking_activity: "Out for delivery", tracking_event_at: "2026-09-30 09:18:00" } })] });
  assert.equal(i.stage?.label, "Out for delivery");
  assert.equal(i.latest_text, null);
  assert.equal(formatAdminWhen(i.latest_at), "30 Sep · 9:18 am");
});

test("J: delivered shows the stored delivered time", () => {
  const j = ops({ status: "DELIVERED", rows: [ship({ status: "delivered", delivered_at: "2026-09-26T07:51:28.737+00:00" })] });
  assert.equal(formatAdminWhen(j.delivered_at), "26 Sep · 1:21 pm");
  assert.deepEqual(opsLines({ status: "DELIVERED", ops: j }), { headline: "Delivered 26 Sep · 1:21 pm", rate: null, detail: "Xpressbees Surface", recorded: true, alert: null });
  assert.equal(j.stage?.ariaLabel, "Delivered. Stage 9 of 9.");
  assert.equal(j.latest_text, null);
});

test("K: a booked shipment without a saved rate shows the courier and never ₹0", () => {
  const k = ops({ status: "IN_TRANSIT", rows: [ship({ status: "in_transit", provider_payload: {} })] });
  assert.equal(k.courier, "Xpressbees Surface");
  assert.equal(k.rate_paise, null);
  assert.equal(opsLines({ status: "IN_TRANSIT", ops: k }).rate, "Rate unavailable");
  assert.equal(savedCourierRatePaise({ rate_paise: 0 }), null);
  assert.equal(savedCourierRatePaise({ booked_rate_paise: 4568, rate_paise: 9999 }), 4568);
});

test("L: a cancelled older shipment never becomes the row courier", () => {
  const rows = [
    ship({ status: "manifested", courier_name: "Blue Dart Air", provider_payload: { rate_paise: 15684, pickup_date: "2026-09-30" } }),
    ship({ status: "cancelled", courier_name: "Delhivery Express", provider: "delhivery", provider_payload: { rate_paise: 9699, do_not_use: true } }),
  ];
  const l = ops({ status: "PICKUP_SCHEDULED", rows });
  assert.equal(l.courier, "Blue Dart Air");
  assert.equal(l.rate_paise, 15684);
  assert.equal(l.package?.source, "BOOKED_SHIPMENT");
  const onlyCancelled = ops({ status: "PACKED", rows: [rows[1]], reasons: ["No active shipment"] });
  assert.equal(onlyCancelled.courier, null);
  assert.equal(onlyCancelled.courier_not_selected, true);
});

test("Q: issues use staff copy and red only when actionable", () => {
  assert.equal(ops({ status: "PACKED", cityConfirm: true, reasons: ["Courier city needs confirmation"] }).issue, "Courier city confirmation");
  assert.equal(ops({ status: "PICKUP_SCHEDULED", reasons: ["Address mismatch"], rows: [ship({})] }).issue, "Shipment needs attention");
  assert.equal(ops({ status: "IN_TRANSIT", rows: [ship({ status: "in_transit" })], reasons: ["Invoice needs attention"] }).issue, null);
  assert.equal(ops({ status: "PACKED", cityConfirm: true, reasons: ["Courier city needs confirmation"] }).courier_not_selected, false);
  const city = ops({ status: "PACKED", cityConfirm: true, reasons: ["Courier city needs confirmation"] });
  assert.equal(opsLines({ status: "PACKED", ops: city }).alert, "issue");
  const orderOps = read("lib/store/orderOps.ts");
  const issueCopy = orderOps.slice(orderOps.indexOf("const ISSUE_COPY"), orderOps.indexOf("export function opsIssue"));
  const copies = [...issueCopy.matchAll(/\["[^"]+", "([^"]+)"\]/g)].map((match) => match[1]);
  for (const copy of [...copies, "Package required"]) assert.ok(ISSUE_HINT[copy], `${copy} has a next-step hint`);
});

test("74: avg shipping rate counts one live shipment per paid order, in paise", () => {
  const paidAt = "2026-09-28T00:00:00Z";
  const orders = [
    { id: "A", status: "PICKUP_SCHEDULED", paid_at: paidAt },
    { id: "B", status: "IN_TRANSIT", paid_at: paidAt },
    { id: "C", status: "DELIVERED", paid_at: paidAt },
    { id: "D", status: "PACKED", paid_at: paidAt },
    { id: "E", status: "PACKED", paid_at: paidAt },
    { id: "F", status: "PRINTING", paid_at: paidAt },
    { id: "G", status: "IN_TRANSIT", paid_at: paidAt, qa: true },
    { id: "H", status: "PAYMENT_EXPIRED", paid_at: null },
    { id: "K", status: "IN_TRANSIT", paid_at: paidAt },
  ];
  const map = new Map<string, ShipmentRowLike[]>([
    ["A", [{ status: "manifested", awb: "a", provider_payload: { rate_paise: 6598 } }, { status: "cancelled", awb: "a0", provider_payload: { rate_paise: 15684 } }]],
    ["B", [{ status: "in_transit", awb: "b", provider_payload: { booked_rate_paise: 9372, rate_paise: 9372 } }]],
    ["C", [{ status: "delivered", awb: "c", provider_payload: { rate_paise: 4568 } }]],
    ["D", []],
    ["E", [{ status: "cancelled", awb: "e", provider_payload: { rate_paise: 15684 } }]],
    ["F", [{ status: "manifested", awb: "f", provider_payload: { rate_paise: 11111 } }]],
    ["G", [{ status: "in_transit", awb: "g", provider_payload: { rate_paise: 22222 } }]],
    ["H", [{ status: "manifested", awb: "h", provider_payload: { rate_paise: 33333 } }]],
    ["K", [{ status: "in_transit", awb: "k", provider_payload: {} }]],
  ]);
  const stats = shippingRateStats(orders, map);
  assert.equal(stats.count, 3);
  assert.equal(stats.avg_paise, Math.round((6598 + 9372 + 4568) / 3));
  assert.equal(stats.min_paise, 4568);
  assert.equal(stats.max_paise, 9372);
  assert.equal(stats.unknown, 1);
  assert.equal(liveShipment(map.get("E")!), null);
});

test("74: pending city confirmation and customer shipping charges never feed the rate", () => {
  const map = new Map<string, ShipmentRowLike[]>([
    ["X", [{ status: "created", awb: "x", provider_payload: { rate_paise: 4568, city_confirm_required: true, destination_accepted: false } }]],
    ["Y", [{ status: "created", awb: "y", provider_payload: { rate_paise: 4568, city_confirm_required: true, destination_accepted: true } }]],
  ]);
  const stats = shippingRateStats(
    [
      { id: "X", status: "PICKUP_SCHEDULED", paid_at: "2026-09-29T00:00:00Z" },
      { id: "Y", status: "PICKUP_SCHEDULED", paid_at: "2026-09-29T00:00:00Z" },
    ],
    map,
  );
  assert.equal(stats.count, 1);
  const route = read("app/api/admin/notes/orders/route.ts");
  const fn = route.slice(route.indexOf("async function shippingRateForCaptured"), route.indexOf("async function paidProductSplit"));
  assert.doesNotMatch(fn, /shipping_paise/);
  assert.match(fn, /shippingRateStats\(/);
});

test("75/61: package display equals what the booking resolver would use", () => {
  const cases: Array<{ rows: Ship[]; items: Array<typeof POLITY> }> = [
    { rows: [], items: [ECONOMY] },
    { rows: [ship({ status: "pending", awb: null, weight_grams: 1000, length_mm: 320, width_mm: 230, height_mm: 40 })], items: [POLITY, ECONOMY] },
    { rows: [], items: [POLITY, ECONOMY] },
    { rows: [ship({ status: "cancelled", weight_grams: 700, length_mm: 310, width_mm: 240, height_mm: 35 })], items: [POLITY] },
  ];
  for (const c of cases) {
    const lines = packageLinesFrom(c.items, products);
    const saved = c.rows.find((r) => r.weight_grams && r.length_mm && r.width_mm && r.height_mm) || null;
    const booking = resolveBookingPackage({
      override: saved ? { weightGrams: saved.weight_grams!, lengthMm: saved.length_mm!, widthMm: saved.width_mm!, heightMm: saved.height_mm! } : null,
      lines,
    });
    const display = resolvePackageDisplay({ rows: c.rows, lines });
    if (!booking.ok) {
      assert.equal(display, null);
      continue;
    }
    assert.deepEqual(
      display && [display.weight_grams, display.length_cm, display.width_cm, display.height_cm],
      [booking.weightGrams, booking.lengthCm, booking.widthCm, booking.heightCm],
    );
    assert.equal(display?.source, booking.source === "STAFF_OVERRIDE" ? "ORDER_PACKAGE" : "PRODUCT_PROFILE");
  }
  const economy = resolvePackageDisplay({ rows: [], lines: packageLinesFrom([ECONOMY], products) })!;
  assert.equal(`${formatPackageWeight(economy.weight_grams)} · ${formatPackageDims(economy)}`, "500 g · 30×25×3 cm");
});

test("package profile comes from the product row, not a UI constant", () => {
  const heavier = new Map([["polity", { weight_grams: 650, length_mm: 305, width_mm: 255, height_mm: 32 }]]);
  const pkg = resolvePackageDisplay({ rows: [], lines: packageLinesFrom([POLITY], heavier) })!;
  assert.equal(pkg.weight_grams, 650);
  assert.equal(formatPackageDims(pkg), "30.5×25.5×3.2 cm");
  for (const file of ROW_FILES) {
    const src = read(file);
    assert.doesNotMatch(src, /(?<![-\w])500(?![\w-])/, `${file} must not hardcode a package weight`);
    assert.doesNotMatch(src, /resolveBookingPackage|resolveAutoPackage|packageLinesFrom/, `${file} must not resolve packages itself`);
  }
});

test("76: a captured in-transit order shows Paid and In transit together", () => {
  const views = read("components/notes/admin/orders/CustomerViews.tsx");
  const summary = views.slice(views.indexOf("function OrderSummary"), views.indexOf("function ModuleLabel"));
  assert.match(summary, /<PaidMark \/>/);
  for (const variant of ["OrderCustomerCardMobile", "OrderCustomerRowDesktop"]) {
    const body = views.slice(views.indexOf(`function ${variant}`));
    assert.match(body, /customerView\(order\)/, `${variant} reads the shared customer view`);
    assert.match(body, /<OpsStrip order=\{line\}/, `${variant} uses the shared status strip`);
    assert.match(body, /<OrderSummary line=\{line\}/);
  }
  const h = ops({ status: "IN_TRANSIT", rows: [ship({ status: "in_transit", provider_payload: { rate_paise: 9372 } })] });
  assert.equal(h.stage?.label, "In transit");
});

test("78/M/N/P: two paid orders for one phone stay one customer with both parcels", () => {
  const phone = "9876543210";
  const base = { customer_name: "Kiran Kumar", phone: `+91 ${phone}`, phone_key: phone, total_paise: 255900 };
  const delivered = { ...base, id: "d", order_no: "NIAS-N-2026-001008", status: "DELIVERED", paid_at: "2026-09-20T00:00:00Z", placed_at: "2026-09-20T00:00:00Z", ops: ops({ status: "DELIVERED", city: "Delhi", state: "Delhi", rows: [ship({ status: "delivered", delivered_at: "2026-09-24T10:12:00Z" })] }) };
  const printing = { ...base, id: "p", order_no: "NIAS-N-2026-001049", status: "PRINTING", paid_at: "2026-09-28T00:00:00Z", placed_at: "2026-09-28T00:00:00Z", ops: ops({ status: "PRINTING", city: "Chandigarh", state: "Chandigarh" }) };
  const failed = { ...base, id: "f", order_no: "NIAS-N-2026-001050", status: "PAYMENT_FAILED", paid_at: null, placed_at: "2026-09-28T01:00:00Z" };
  const groups = groupNotesCustomers([delivered, printing, failed]);
  assert.equal(groups.length, 1);
  const group = groups[0];
  assert.equal(group.paid_count, 2);
  assert.equal(group.attempts, 3);
  assert.equal(group.phone, phone, "full normalized phone for the admin row");
  assert.equal(group.masked_phone, "••••3210");
  const captured = group.orders.filter((o) => o.paid_at);
  assert.deepEqual(captured.map((o) => o.ops?.stage?.label).sort(), ["Delivered", "Printing"]);
  assert.deepEqual(captured.map((o) => o.ops?.city).sort(), ["Chandigarh", "Delhi"]);
  assert.equal(groupMatchesBucket(group, "printing"), true);
  assert.equal(groupMatchesBucket(group, "delivered"), true);
  const route = read("app/api/admin/notes/orders/route.ts");
  assert.match(route, /paid_orders: paidOrdersForRow\(group\.orders\)/);
  assert.match(route, /phone: group\.phone/);
});

test("62: badge, dots and filter labels come from the one shared ladder", () => {
  assert.equal(TIMELINE.length, PROGRESS.length);
  for (const step of PROGRESS) {
    for (const status of step.statuses) {
      assert.equal(stageProgress(status)?.label, adminStageLabel(status));
      assert.equal(stageProgress(status)?.key, step.key);
    }
  }
  const timeline = read("components/notes/admin/orders/FulfillmentTimeline.tsx");
  assert.match(timeline, /stageProgress\(status\)/);
  assert.match(timeline, /useReducedMotion\(\)/);
  assert.match(timeline, /reduce \? \{ duration: 0 \} : \{ duration: 2\.8, ease: "easeInOut", repeat: Infinity \}/, "breathing halo only when motion is allowed");
  assert.match(timeline, /scale: \[1, 1\.08, 1\]/);
  assert.match(timeline, /aria-label=\{stage\.ariaLabel\}/);
  assert.equal(stageProgress("PACKED")?.ariaLabel, "Packed. Stage 4 of 9.");
  for (const file of ROW_FILES) {
    assert.doesNotMatch(read(file), /IN_TRANSIT|PICKUP_SCHEDULED|OUT_FOR_DELIVERY|READY_FOR_PICKUP/, `${file}: no second status mapping in the row`);
  }
  for (const file of ["components/notes/admin/orders/CustomerViews.tsx", "components/notes/admin/orders/OrderOpsCell.tsx"]) {
    assert.match(read(file), /useReducedMotion\(\)/, `${file} honours reduced motion`);
  }
  for (const file of [...ROW_FILES, "components/notes/admin/orders/FulfillmentTimeline.tsx"]) {
    assert.doesNotMatch(read(file), /\b(LazyMotion|MotionConfig|domAnimation)\b/, `${file}: only framer APIs the storefront already ships, so the shared chunk is unchanged`);
  }
});

test("47: a two-subject order reads as both subjects", () => {
  assert.equal(productList([{ name: "Indian Polity Notes", qty: 1 }, { name: "Indian Economy Notes", qty: 1 }]), "Polity ×1 + Economy ×1");
  assert.equal(productList([{ name: "Modern History Notes", qty: 2 }]), "Modern History ×2");
});

test("38/70: the list refreshes from our API only and never calls a courier", () => {
  const queue = read("components/notes/admin/OrderQueue.tsx");
  assert.match(queue, /REFRESH_MS = 45_000/);
  assert.match(queue, /visibilityState/);
  assert.match(queue, /addEventListener\("focus"/);
  assert.doesNotMatch(queue, /\/rates|\/dispatch|\/pack"|shiprocket|delhivery/i);
  const route = read("app/api/admin/notes/orders/route.ts");
  assert.doesNotMatch(route, /shiprocketApi|delhiveryApi|fetchRates|getQuotes/);
});

test("48: full phone stays inside the authenticated admin read model", () => {
  const route = read("app/api/admin/notes/orders/route.ts");
  assert.match(route, /requireStoreOrderRead\(\)/);
  for (const file of ["lib/store/orders.ts", "app/api/notes/orders/route.ts"]) {
    let src = "";
    try {
      src = read(file);
    } catch {
      continue;
    }
    assert.doesNotMatch(src, /orderOps|group\.phone/, `${file} must not expose the admin phone field`);
  }
  for (const file of ROW_FILES) {
    assert.doesNotMatch(read(file), /track\(|posthog|gtag|fbq|console\.log/, `${file} must not send phone to telemetry`);
  }
});
