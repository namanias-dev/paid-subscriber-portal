/**
 * Preparation-demand engine (spec §21).
 *
 * Answers the one question the Academy's print-on-demand model needs: "how many
 * physical copies of each subject must we prepare right now?" Computed from
 * PAID, not-yet-dispatched orders only — never cart, pending/failed payment,
 * cancelled, or already-shipped quantities.
 *
 * Bundles are exploded into their component products so a "GS Complete" order
 * turns into demand for each physical booklet, never a phantom "bundle" copy.
 *
 * The aggregation is a pure function so it can be unit-tested without a database.
 */
import { storeDb } from "./db";
import { PREPARATION_STATUSES, type AvailabilityMode } from "./availability";

export interface PrepInputItem {
  order_id: string;
  product_id: string;
  qty: number;
}

export interface PrepProduct {
  id: string;
  name: string;
  sku: string;
  subject: string | null;
  kind: "single" | "bundle";
  availability_mode: AvailabilityMode;
  /** on_hand - reserved, for ready_stock demand-vs-stock maths. */
  sellable: number;
}

export interface PreparationRow {
  product_id: string;
  name: string;
  sku: string;
  subject: string | null;
  availability_mode: AvailabilityMode;
  /** Paid-unfulfilled copies required. */
  demand: number;
  /** Distinct orders contributing to this demand. */
  orders: number;
  /** Ready copies available (null for on_demand — no stock counter). */
  ready_stock: number | null;
  /** Copies still to prepare after existing ready stock. */
  additional_required: number;
}

type BundleComponents = Map<string, Array<{ component_id: string; qty: number }>>;

/**
 * Pure aggregation. Expands bundle lines into component demand and computes
 * additional copies required against ready stock.
 */
export function aggregatePreparation(
  items: PrepInputItem[],
  products: Map<string, PrepProduct>,
  bundleComponents: BundleComponents,
): PreparationRow[] {
  const demand = new Map<string, number>();
  const orderSets = new Map<string, Set<string>>();

  const add = (productId: string, qty: number, orderId: string) => {
    demand.set(productId, (demand.get(productId) || 0) + qty);
    if (!orderSets.has(productId)) orderSets.set(productId, new Set());
    orderSets.get(productId)!.add(orderId);
  };

  for (const item of items) {
    if (item.qty <= 0) continue;
    const product = products.get(item.product_id);
    const components = bundleComponents.get(item.product_id);
    if (product?.kind === "bundle" && components?.length) {
      for (const c of components) add(c.component_id, item.qty * c.qty, item.order_id);
    } else {
      add(item.product_id, item.qty, item.order_id);
    }
  }

  const rows: PreparationRow[] = [];
  for (const [productId, qty] of demand) {
    const p = products.get(productId);
    const isReady = p?.availability_mode === "ready_stock";
    const readyStock = isReady ? Math.max(0, Math.floor(p!.sellable)) : null;
    const additional = readyStock == null ? qty : Math.max(0, qty - readyStock);
    rows.push({
      product_id: productId,
      name: p?.name || "Unknown product",
      sku: p?.sku || "",
      subject: p?.subject ?? null,
      availability_mode: p?.availability_mode || "on_demand",
      demand: qty,
      orders: orderSets.get(productId)?.size || 0,
      ready_stock: readyStock,
      additional_required: additional,
    });
  }
  // Most pressing first: the biggest shortfall, then the biggest demand.
  rows.sort((a, b) => b.additional_required - a.additional_required || b.demand - a.demand);
  return rows;
}

/** Load paid-unfulfilled demand from the database and aggregate it. */
export async function computePreparationDemand(): Promise<PreparationRow[]> {
  const db = storeDb();
  if (!db) return [];

  const { data: orders } = await db
    .from("store_orders")
    .select("id")
    .in("status", [...PREPARATION_STATUSES]);
  const orderIds = (orders || []).map((o) => o.id);
  if (!orderIds.length) return [];

  const { data: items } = await db
    .from("store_order_items")
    .select("order_id,product_id,qty")
    .in("order_id", orderIds);
  const inputItems: PrepInputItem[] = (items || []).map((i) => ({
    order_id: i.order_id,
    product_id: i.product_id,
    qty: Number(i.qty),
  }));
  if (!inputItems.length) return [];

  const orderedProductIds = [...new Set(inputItems.map((i) => i.product_id))];

  // Bundle components for any ordered bundles.
  const { data: bundleRows } = await db
    .from("store_bundle_items")
    .select("bundle_id,component_id,qty")
    .in("bundle_id", orderedProductIds);
  const bundleComponents: BundleComponents = new Map();
  for (const b of bundleRows || []) {
    if (!bundleComponents.has(b.bundle_id)) bundleComponents.set(b.bundle_id, []);
    bundleComponents.get(b.bundle_id)!.push({ component_id: b.component_id, qty: Number(b.qty) });
  }

  // Every product we need to describe: ordered products + any bundle components.
  const allIds = new Set(orderedProductIds);
  for (const list of bundleComponents.values()) for (const c of list) allIds.add(c.component_id);

  const { data: products } = await db
    .from("store_products")
    .select("id,name,sku,subject,kind,availability_mode,on_hand,reserved")
    .in("id", [...allIds]);
  const productMap = new Map<string, PrepProduct>();
  for (const p of products || []) {
    productMap.set(p.id, {
      id: p.id,
      name: p.name,
      sku: p.sku,
      subject: p.subject ?? null,
      kind: p.kind === "bundle" ? "bundle" : "single",
      availability_mode: (p.availability_mode as AvailabilityMode) || "ready_stock",
      sellable: Math.max(0, Number(p.on_hand || 0) - Number(p.reserved || 0)),
    });
  }

  return aggregatePreparation(inputItems, productMap, bundleComponents);
}
