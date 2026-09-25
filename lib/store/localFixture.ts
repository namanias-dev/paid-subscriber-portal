/**
 * In-memory Notes Store used only by a local process.
 *
 * Preview and production share one Supabase project, so a "test order" inserted
 * through either environment would be a real business row. This client never
 * opens when `VERCEL` is set or when `VERCEL_ENV` is production, even if
 * `NOTES_STORE_LOCAL_FIXTURE=1` is copied into those environments by mistake.
 *
 * It is not a second store. It speaks the same query shape the admin and
 * tracking routes already use, and it holds exactly one seeded test order.
 */
import { hashStoreAccessToken } from "./accessToken";

export const LOCAL_FIXTURE_ORDER_NO = "NIAS-N-2026-900001";
export const LOCAL_FIXTURE_ORDER_ID = "11111111-1111-4111-8111-111111111111";
export const LOCAL_FIXTURE_AWB = "TESTAWB110001";
export const LOCAL_FIXTURE_TOKEN = "fixture-order-access";

const IDS = {
  order: LOCAL_FIXTURE_ORDER_ID,
  address: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  item: "44444444-4444-4444-8444-444444444444",
  payment: "55555555-5555-4555-8555-555555555555",
  customer: "66666666-6666-4666-8666-666666666666",
  event: "77777777-7777-4777-8777-777777777777",
};

type Row = Record<string, unknown>;

const globalFixture = globalThis as typeof globalThis & { __niasLocalFixture?: Map<string, Row[]> };
const tables = globalFixture.__niasLocalFixture || new Map<string, Row[]>();
globalFixture.__niasLocalFixture = tables;

export function localFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.VERCEL || "").trim()) return false;
  if ((env.VERCEL_ENV || "").trim() === "production") return false;
  const flag = (env.NOTES_STORE_LOCAL_FIXTURE || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function phoneKey(phone: unknown): string {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

function blankTables(): void {
  tables.clear();
  for (const name of [
    "store_customers",
    "store_addresses",
    "store_products",
    "store_product_media",
    "store_orders",
    "store_order_items",
    "store_order_payments",
    "store_order_events",
    "store_shipments",
    "store_shipment_events",
    "store_categories",
    "store_bundles",
    "store_bundle_items",
    "store_subject_interest",
    "store_interest_submissions",
    "store_interest_submission_subjects",
    "store_offers",
    "store_offer_holds",
    "store_carts",
    "store_cart_items",
    "store_zones",
    "store_pincode_cache",
    "store_inventory_reservations",
    "app_feature_flags",
    "store_invoices",
    "store_invoice_settings",
    "store_invoice_counters",
  ]) {
    tables.set(name, []);
  }
}

/** Replace memory with the single confirmed test order. */
export function resetLocalFixture(): void {
  blankTables();
  const now = nowIso();
  tables.get("store_customers")!.push({
    id: IDS.customer,
    name: "Naman IAS Shipping Test",
    phone: "9000000001",
    email: "shipping-test@example.com",
    created_at: now,
  });
  tables.get("store_addresses")!.push({
    id: IDS.address,
    name: "Naman IAS Shipping Test",
    phone: "9000000001",
    line1: "Test desk, Connaught Place",
    line2: null,
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    landmark: null,
    delivery_instructions: "TEST FIXTURE",
  });
  tables.get("store_products")!.push({
    id: IDS.product,
    sku: "POLITY",
    slug: "polity",
    kind: "single",
    name: "Indian Polity Notes",
    short_name: "Polity",
    subject: "Polity",
    availability_mode: "on_demand",
    is_active: true,
    archived_at: null,
    mrp_paise: 299900,
    selling_price_paise: 239920,
    on_hand: 20,
    reserved: 1,
    low_stock_threshold: 5,
    category_id: null,
    position: 1,
  });
  tables.get("store_orders")!.push({
    id: IDS.order,
    order_no: LOCAL_FIXTURE_ORDER_NO,
    status: "ORDER_CONFIRMED",
    customer_id: IDS.customer,
    customer_name: "Naman IAS Shipping Test",
    phone: "9000000001",
    email: "shipping-test@example.com",
    shipping_address_id: IDS.address,
    billing_address_id: IDS.address,
    subtotal_paise: 239920,
    discount_paise: 0,
    shipping_paise: 9900,
    tax_paise: 0,
    total_paise: 249820,
    amount_paid_paise: 249820,
    amount_refunded_paise: 0,
    promo_code: null,
    discount_trace_json: null,
    internal_notes: "TEST FIXTURE. No ICICI charge. No courier booking.",
    placed_at: now,
    paid_at: now,
    shipped_at: null,
    delivered_at: null,
    promised_delivery_date: null,
    tracking_token: null,
    tracking_token_hash: hashStoreAccessToken(LOCAL_FIXTURE_TOKEN),
    offer_id: null,
    created_at: now,
    updated_at: now,
  });
  tables.get("store_order_items")!.push({
    id: IDS.item,
    order_id: IDS.order,
    product_id: IDS.product,
    name_snapshot: "Indian Polity Notes",
    sku_snapshot: "POLITY",
    qty: 1,
    unit_price_paise: 239920,
    line_discount_paise: 0,
    line_total_paise: 239920,
    tax_treatment_snapshot: "exempt",
    tax_rate_bps_snapshot: 0,
    hsn_snapshot: null,
    created_at: now,
  });
  tables.get("store_order_payments")!.push({
    id: IDS.payment,
    order_id: IDS.order,
    provider: "TEST_FIXTURE",
    reference_no: "NIASN-N-TESTSHIP-01",
    gateway_ref: "TEST-NO-CHARGE",
    status: "CAPTURED",
    method: "test_fixture",
    amount_paise: 249820,
    created_at: now,
    updated_at: now,
  });
  tables.get("store_invoice_settings")!.push({
    id: 1,
    display_name: "Naman IAS Academy",
    legal_name: null,
    address_line: null,
    city: null,
    state: null,
    state_code: null,
    pincode: null,
    gstin: null,
    invoice_prefix: "NIA",
    price_tax_mode: "inclusive",
    document_mode: "auto",
    legal_footer: null,
    logo_url: null,
  });
  tables.get("store_order_events")!.push({
    id: IDS.event,
    order_id: IDS.order,
    event: "test_fixture_seeded",
    from_status: null,
    to_status: "ORDER_CONFIRMED",
    actor_type: "system",
    actor_name: "local-fixture",
    payload_json: { marker: "TEST" },
    created_at: now,
  });
}

function rows(table: string): Row[] {
  if (!tables.has(table)) tables.set(table, []);
  return tables.get(table)!;
}

function orderRow(): Row {
  const found = rows("store_orders").find((row) => row.id === IDS.order);
  if (!found) throw new Error("local fixture order missing");
  return found;
}

function ensureShipment(patch: Row): Row {
  const existing = rows("store_shipments").find((row) => row.order_id === IDS.order);
  const now = nowIso();
  if (!existing) {
    const created: Row = {
      id: "88888888-8888-4888-8888-888888888888",
      order_id: IDS.order,
      provider: "manual",
      status: "pending",
      awb: null,
      courier_name: null,
      courier_id: null,
      label_r2_key: null,
      provider_payload: null,
      weight_grams: 800,
      length_mm: 300,
      width_mm: 220,
      height_mm: 30,
      pickup_scheduled_at: null,
      picked_up_at: null,
      last_synced_at: null,
      expected_delivery_date: null,
      created_at: now,
      updated_at: now,
      ...patch,
    };
    rows("store_shipments").push(created);
    return created;
  }
  Object.assign(existing, patch, { updated_at: now });
  return existing;
}

const SCENES = [
  "reset",
  "packed_no_awb",
  "shipment_failed",
  "awb_label",
  "pickup_scheduled",
  "pickup_overdue",
  "tracking_stale",
  "delivery_failed",
  "ndr",
  "rto",
  "return_waiting",
  "refund_pending",
  "delivered",
] as const;

export type LocalFixtureScene = (typeof SCENES)[number];

/** Move the single test order to a named state. Never calls a courier. */
export function applyLocalFixtureScene(scene: string): { ok: true; scene: LocalFixtureScene; status: string } | { ok: false; error: string } {
  if (!SCENES.includes(scene as LocalFixtureScene)) return { ok: false, error: "Unknown fixture scene." };
  if (scene === "reset") {
    resetLocalFixture();
    return { ok: true, scene, status: "ORDER_CONFIRMED" };
  }
  if (tables.size === 0) resetLocalFixture();
  const order = orderRow();
  const pack = { weight_grams: 800, length_mm: 300, width_mm: 220, height_mm: 30 };
  if (scene === "packed_no_awb") {
    order.status = "PACKED";
    ensureShipment({ ...pack, provider: "manual", status: "pending", awb: null });
  } else if (scene === "shipment_failed") {
    order.status = "PACKED";
    ensureShipment({ ...pack, provider: "shiprocket", status: "failed", awb: null, last_error: "TEST: creation was not sent" });
  } else if (scene === "awb_label") {
    order.status = "READY_FOR_PICKUP";
    ensureShipment({
      ...pack,
      provider: "delhivery",
      status: "manifested",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Delhivery Surface",
      provider_payload: { label_url: "fixture:test-label", test: true },
    });
  } else if (scene === "pickup_scheduled") {
    order.status = "PICKUP_SCHEDULED";
    ensureShipment({
      ...pack,
      provider: "delhivery",
      status: "manifested",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Delhivery Surface",
      provider_payload: { label_url: "fixture:test-label", test: true },
      pickup_scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } else if (scene === "pickup_overdue") {
    order.status = "PICKUP_SCHEDULED";
    ensureShipment({
      ...pack,
      provider: "delhivery",
      status: "manifested",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Delhivery Surface",
      created_at: daysAgo(3),
      pickup_scheduled_at: daysAgo(2),
      picked_up_at: null,
      last_synced_at: nowIso(),
    });
  } else if (scene === "tracking_stale") {
    order.status = "IN_TRANSIT";
    order.shipped_at = daysAgo(2);
    ensureShipment({
      ...pack,
      provider: "delhivery",
      status: "in_transit",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Delhivery Surface",
      picked_up_at: daysAgo(2),
      last_synced_at: daysAgo(1),
      created_at: daysAgo(3),
    });
  } else if (scene === "delivery_failed") {
    order.status = "DELIVERY_FAILED";
    order.shipped_at = daysAgo(2);
    ensureShipment({
      ...pack,
      provider: "delhivery",
      status: "delivery_failed",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Delhivery Surface",
      last_synced_at: nowIso(),
    });
  } else if (scene === "ndr") {
    order.status = "REATTEMPT_REQUESTED";
    order.shipped_at = daysAgo(2);
    ensureShipment({
      ...pack,
      provider: "shiprocket",
      status: "delivery_failed",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "DTDC Surface",
      last_synced_at: nowIso(),
    });
  } else if (scene === "rto") {
    order.status = "RTO_INITIATED";
    order.shipped_at = daysAgo(3);
    ensureShipment({
      ...pack,
      provider: "shiprocket",
      status: "rto",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Xpressbees Surface",
      last_synced_at: nowIso(),
    });
  } else if (scene === "return_waiting") {
    order.status = "RETURN_REQUESTED";
    order.delivered_at = daysAgo(1);
    order.internal_notes = "TEST FIXTURE\ncustomer: [damaged] Damaged notes — cover bent on the test parcel.";
    ensureShipment({
      ...pack,
      provider: "delhivery",
      status: "delivered",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Delhivery Surface",
      delivered_at: daysAgo(1),
    });
  } else if (scene === "delivered") {
    order.status = "DELIVERED";
    order.shipped_at = order.shipped_at || daysAgo(2);
    order.delivered_at = nowIso();
    ensureShipment({
      ...pack,
      provider: "delhivery",
      status: "delivered",
      awb: LOCAL_FIXTURE_AWB,
      courier_name: "Delhivery Surface",
      provider_payload: { label_url: "fixture:test-label", test: true },
      last_synced_at: nowIso(),
    });
  } else if (scene === "refund_pending") {
    order.status = "REFUND_PENDING";
    order.internal_notes = "TEST FIXTURE. Refund pending manual payment-gateway processing. ICICI was not called.";
  }
  return { ok: true, scene: scene as LocalFixtureScene, status: String(order.status) };
}

function like(value: unknown, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(String(value ?? ""));
}

function splitOr(expr: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function matchClause(row: Row, clause: string): boolean {
  const match = clause.match(/^([a-zA-Z0-9_]+)\.(ilike|like|eq|in|gte)\.(.*)$/);
  if (!match) return false;
  const [, col, op, rest] = match;
  if (op === "ilike" || op === "like") return like(row[col], rest);
  if (op === "eq") return String(row[col] ?? "") === rest;
  if (op === "gte") return String(row[col] ?? "") >= rest;
  const inner = rest.replace(/^\(/, "").replace(/\)$/, "");
  const vals = inner ? inner.split(",").filter(Boolean) : [];
  return vals.includes(String(row[col] ?? ""));
}

class FixtureQuery {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private filters: Array<(row: Row) => boolean> = [];
  private orFilters: Array<(row: Row) => boolean> = [];
  private sorts: Array<{ col: string; ascending: boolean }> = [];
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private head = false;
  private wantCount = false;
  private cardinality: "maybe" | "one" | null = null;
  private payload: Row | Row[] | null = null;
  private patch: Row | null = null;
  private returning = false;

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.head = true;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(patch: Row): this {
    this.action = "update";
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.action = "delete";
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  in(col: string, vals: unknown[]): this {
    const set = new Set(vals);
    this.filters.push((row) => set.has(row[col]));
    return this;
  }

  gte(col: string, val: unknown): this {
    this.filters.push((row) => String(row[col] ?? "") >= String(val ?? ""));
    return this;
  }

  ilike(col: string, pattern: string): this {
    this.filters.push((row) => like(row[col], pattern));
    return this;
  }

  like(col: string, pattern: string): this {
    return this.ilike(col, pattern);
  }

  is(col: string, val: unknown): this {
    this.filters.push((row) => (val === null ? row[col] == null : row[col] === val));
    return this;
  }

  or(expr: string): this {
    const clauses = splitOr(expr);
    this.orFilters.push((row) => clauses.some((clause) => matchClause(row, clause.trim())));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.sorts.push({ col, ascending: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this {
    this.lim = n;
    return this;
  }

  range(from: number, to: number): this {
    this.rng = [from, to];
    return this;
  }

  maybeSingle(): this {
    this.cardinality = "maybe";
    return this;
  }

  single(): this {
    this.cardinality = "one";
    return this;
  }

  then<T>(resolve: (value: { data: unknown; error: { message: string } | null; count?: number | null }) => T, reject?: (reason: unknown) => T): Promise<T> {
    return Promise.resolve(this.exec()).then(resolve, reject);
  }

  private decorate(row: Row): Row {
    const copy = { ...row };
    if (this.table === "store_orders") copy.phone_key = phoneKey(copy.phone);
    return copy;
  }

  private view(row: Row): Row {
    if (this.table !== "store_orders") return row;
    return { ...row, phone_key: phoneKey(row.phone) };
  }

  private matched(): Row[] {
    return rows(this.table).filter((row) => {
      const view = this.view(row);
      return this.filters.every((fn) => fn(view)) && this.orFilters.every((fn) => fn(view));
    });
  }

  private exec(): { data: unknown; error: { message: string } | null; count?: number | null } {
    if (this.action === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload || {}];
      const created: Row[] = [];
      for (const raw of incoming) {
        const row: Row = { ...raw };
        if (!row.id) row.id = crypto.randomUUID();
        const stamp = nowIso();
        if (!row.created_at) row.created_at = stamp;
        if (!row.updated_at) row.updated_at = stamp;
        if (this.table === "store_orders" && !row.placed_at) row.placed_at = stamp;
        if (this.table === "store_invoices" && rows(this.table).some((existing) => existing.order_id === row.order_id || existing.invoice_number === row.invoice_number)) {
          return { data: null, error: { message: "duplicate invoice" }, count: 0 };
        }
        rows(this.table).push(row);
        created.push(this.decorate(row));
      }
      if (this.cardinality === "one") return { data: created[0] || null, error: created[0] ? null : { message: "insert failed" }, count: created.length };
      if (this.cardinality === "maybe") return { data: created.length === 1 ? created[0] : null, error: null, count: created.length };
      return { data: this.returning ? created : null, error: null, count: created.length };
    }

    const matched = this.matched();
    if (this.action === "update") {
      const patch = this.patch || {};
      for (const row of matched) Object.assign(row, patch);
      return { data: null, error: null, count: matched.length };
    }
    if (this.action === "delete") {
      const keep = rows(this.table).filter((row) => !matched.includes(row));
      tables.set(this.table, keep);
      return { data: null, error: null, count: matched.length };
    }

    const count = matched.length;
    const sorted = [...matched];
    for (const sort of [...this.sorts].reverse()) {
      sorted.sort((a, b) => {
        const av = String(a[sort.col] ?? "");
        const bv = String(b[sort.col] ?? "");
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sort.ascending ? cmp : -cmp;
      });
    }
    let sliced = sorted;
    if (this.rng) sliced = sorted.slice(this.rng[0], this.rng[1] + 1);
    else if (this.lim != null) sliced = sorted.slice(0, this.lim);
    const data = sliced.map((row) => this.decorate(row));
    if (this.head) return { data: null, error: null, count };
    if (this.cardinality === "maybe") {
      if (data.length > 1) return { data: null, error: { message: "multiple rows" }, count };
      return { data: data[0] || null, error: null, count };
    }
    if (this.cardinality === "one") {
      if (data.length !== 1) return { data: null, error: { message: data.length ? "multiple rows" : "no rows" }, count };
      return { data: data[0], error: null, count };
    }
    return { data, error: null, count: this.wantCount ? count : null };
  }
}

export function localFixtureClient() {
  if (tables.size === 0) resetLocalFixture();
  return {
    from(table: string) {
      return new FixtureQuery(table);
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "next_store_order_no") return Promise.resolve({ data: "NIAS-N-2026-900099", error: null });
      if (fn === "store_commit_reservations") return Promise.resolve({ data: 0, error: null });
      if (fn === "next_store_invoice_seq") {
        const namespace = String(args?.p_namespace || "test");
        const fy = String(args?.p_fy || "");
        const table = rows("store_invoice_counters");
        const found = table.find((row) => row.namespace === namespace && row.financial_year === fy);
        if (!found) {
          table.push({ namespace, financial_year: fy, last_value: 1 });
          return Promise.resolve({ data: 1, error: null });
        }
        found.last_value = Number(found.last_value) + 1;
        return Promise.resolve({ data: found.last_value, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "rpc unavailable" } });
    },
  };
}

if (tables.size === 0) resetLocalFixture();
