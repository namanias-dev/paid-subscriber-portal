/**
 * Notes Store limited-time offers.
 *
 * Server time is authoritative. Browser countdowns are presentation only.
 * Redemptions increment only on a successful paid order (Verify CAPTURED),
 * never on page views or cart opens. Capacity is reserved at checkout via
 * store_offer_holds and released if payment fails or the reservation TTL lapses.
 */
import { storeDb } from "./db";
import {
  type OfferForPricing,
  type StoreOfferDiscountType,
  type StoreOfferScope,
} from "./pricing";

/** Matches inventory / quote lock TTL so an unpaid hold cannot outlive the cart. */
const OFFER_HOLD_TTL_SECONDS = 15 * 60;

export type { OfferForPricing, StoreOfferDiscountType, StoreOfferScope };

export type StoreOfferLifecycle = "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED" | "PAUSED";

export interface StoreOfferRow {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  discount_type: StoreOfferDiscountType;
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions_used: number;
  scope: StoreOfferScope;
  product_ids: string[];
  category_ids: string[];
  banner_title: string | null;
  banner_subtitle: string | null;
  badge_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicStoreOffer extends OfferForPricing {
  banner_title: string | null;
  banner_subtitle: string | null;
  badge_text: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions_used: number;
  remaining_redemptions: number | null;
  status: StoreOfferLifecycle;
  server_now: string;
}

export interface OfferWriteInput {
  name: string;
  slug?: string;
  enabled: boolean;
  discount_type: StoreOfferDiscountType;
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  scope: StoreOfferScope;
  product_ids?: string[];
  category_ids?: string[];
  banner_title?: string | null;
  banner_subtitle?: string | null;
  badge_text?: string | null;
}

const OFFER_COLS =
  "id,name,slug,enabled,discount_type,discount_value,starts_at,ends_at,max_redemptions,redemptions_used,scope,product_ids,category_ids,banner_title,banner_subtitle,badge_text,created_at,updated_at";

export function slugifyOfferName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "offer";
}

export function deriveOfferStatus(
  offer: Pick<
    StoreOfferRow,
    "enabled" | "starts_at" | "ends_at" | "max_redemptions" | "redemptions_used"
  >,
  now: Date = new Date(),
  held = 0,
): StoreOfferLifecycle {
  const t = now.getTime();
  const starts = offer.starts_at ? new Date(offer.starts_at).getTime() : null;
  const ends = offer.ends_at ? new Date(offer.ends_at).getTime() : null;
  const cap = offer.max_redemptions;
  const used = Math.max(0, Number(offer.redemptions_used) || 0) + Math.max(0, held);
  const capReached = cap != null && used >= cap;
  const endedByTime = ends != null && t >= ends;
  const notStarted = starts != null && t < starts;

  if (!offer.enabled) {
    if (endedByTime || capReached) return "ENDED";
    if (starts != null && !notStarted) return "PAUSED";
    return "DRAFT";
  }
  if (endedByTime || capReached) return "ENDED";
  if (notStarted) return "SCHEDULED";
  return "ACTIVE";
}

export function remainingRedemptions(
  offer: Pick<StoreOfferRow, "max_redemptions" | "redemptions_used">,
  held = 0,
): number | null {
  if (offer.max_redemptions == null) return null;
  return Math.max(0, offer.max_redemptions - (Number(offer.redemptions_used) || 0) - held);
}

export function validateOfferInput(input: OfferWriteInput): string[] {
  const errors: string[] = [];
  if (!String(input.name || "").trim()) errors.push("Name is required");
  if (input.discount_type !== "percentage" && input.discount_type !== "fixed_amount") {
    errors.push("Discount type must be percentage or fixed amount");
  }
  const value = Number(input.discount_value);
  if (!Number.isFinite(value) || value <= 0) errors.push("Discount must be greater than 0");
  if (input.discount_type === "percentage" && value > 100) errors.push("Percentage cannot exceed 100");
  if (input.discount_type === "fixed_amount" && value < 1) errors.push("Fixed discount must be at least 1 paisa");
  const scopes: StoreOfferScope[] = [
    "individual_subjects",
    "all_products",
    "specific_products",
    "specific_categories",
    "bundles",
  ];
  if (!scopes.includes(input.scope)) errors.push("Choose a valid offer scope");
  if (input.scope === "specific_products" && !(input.product_ids || []).length) {
    errors.push("Select at least one eligible product");
  }
  if (input.scope === "specific_categories" && !(input.category_ids || []).length) {
    errors.push("Select at least one eligible category");
  }
  if (input.max_redemptions != null) {
    const cap = Number(input.max_redemptions);
    if (!Number.isFinite(cap) || cap <= 0) errors.push("Order limit must be greater than 0");
  }
  if (input.starts_at && input.ends_at) {
    if (new Date(input.ends_at).getTime() <= new Date(input.starts_at).getTime()) {
      errors.push("End time must be after the start time");
    }
  }
  return errors;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

function toRow(raw: Record<string, unknown>): StoreOfferRow {
  return {
    id: String(raw.id),
    name: String(raw.name),
    slug: String(raw.slug),
    enabled: !!raw.enabled,
    discount_type: raw.discount_type === "fixed_amount" ? "fixed_amount" : "percentage",
    discount_value: Number(raw.discount_value || 0),
    starts_at: (raw.starts_at as string) || null,
    ends_at: (raw.ends_at as string) || null,
    max_redemptions: raw.max_redemptions == null ? null : Number(raw.max_redemptions),
    redemptions_used: Number(raw.redemptions_used || 0),
    scope: (raw.scope as StoreOfferScope) || "individual_subjects",
    product_ids: asStringArray(raw.product_ids),
    category_ids: asStringArray(raw.category_ids),
    banner_title: (raw.banner_title as string) || null,
    banner_subtitle: (raw.banner_subtitle as string) || null,
    badge_text: (raw.badge_text as string) || null,
    created_at: String(raw.created_at || ""),
    updated_at: String(raw.updated_at || ""),
  };
}

export function toPricingOffer(row: StoreOfferRow): OfferForPricing {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    discount_type: row.discount_type,
    discount_value: row.discount_value,
    scope: row.scope,
    product_ids: row.product_ids,
    category_ids: row.category_ids,
    badge_text: row.badge_text,
  };
}

export function toPublicOffer(row: StoreOfferRow, now = new Date(), held = 0): PublicStoreOffer {
  return {
    ...toPricingOffer(row),
    banner_title: row.banner_title,
    banner_subtitle: row.banner_subtitle,
    badge_text: row.badge_text,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    max_redemptions: row.max_redemptions,
    redemptions_used: row.redemptions_used,
    remaining_redemptions: remainingRedemptions(row, held),
    status: deriveOfferStatus(row, now, held),
    server_now: now.toISOString(),
  };
}

export async function releaseExpiredOfferHolds(): Promise<void> {
  const db = storeDb();
  if (!db) return;
  await db.rpc("store_release_expired_offer_holds");
}

export async function listStoreOffers(): Promise<Array<StoreOfferRow & { status: StoreOfferLifecycle; remaining_redemptions: number | null; held: number }>> {
  const db = storeDb();
  if (!db) return [];
  await releaseExpiredOfferHolds();
  const { data, error } = await db.from("store_offers").select(OFFER_COLS).order("created_at", { ascending: false });
  if (error) {
    console.error("[store/offers] list failed", error.message);
    return [];
  }
  const rows = (data || []).map((r) => toRow(r as Record<string, unknown>));
  const heldByOffer = new Map<string, number>();
  if (rows.length) {
    const { data: holds } = await db
      .from("store_offer_holds")
      .select("offer_id")
      .eq("status", "held")
      .in(
        "offer_id",
        rows.map((r) => r.id),
      );
    for (const h of holds || []) {
      heldByOffer.set(h.offer_id, (heldByOffer.get(h.offer_id) || 0) + 1);
    }
  }
  const now = new Date();
  return rows.map((row) => {
    const held = heldByOffer.get(row.id) || 0;
    return {
      ...row,
      held,
      status: deriveOfferStatus(row, now, held),
      remaining_redemptions: remainingRedemptions(row, held),
    };
  });
}

export async function getStoreOfferById(id: string): Promise<StoreOfferRow | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db.from("store_offers").select(OFFER_COLS).eq("id", id).maybeSingle();
  return data ? toRow(data as Record<string, unknown>) : null;
}

export async function getActiveStoreOffer(): Promise<StoreOfferRow | null> {
  const db = storeDb();
  if (!db) return null;
  await releaseExpiredOfferHolds();
  const now = new Date();
  const { data, error } = await db.from("store_offers").select(OFFER_COLS).eq("enabled", true).order("created_at", { ascending: false });
  if (error) {
    console.error("[store/offers] active lookup failed", error.message);
    return null;
  }
  const rows = (data || []).map((r) => toRow(r as Record<string, unknown>));
  if (!rows.length) return null;

  const { data: holds } = await db
    .from("store_offer_holds")
    .select("offer_id")
    .eq("status", "held")
    .in(
      "offer_id",
      rows.map((r) => r.id),
    );
  const heldByOffer = new Map<string, number>();
  for (const h of holds || []) {
    heldByOffer.set(h.offer_id, (heldByOffer.get(h.offer_id) || 0) + 1);
  }

  for (const row of rows) {
    const held = heldByOffer.get(row.id) || 0;
    if (deriveOfferStatus(row, now, held) === "ACTIVE") return row;
  }
  return null;
}

export async function getPublicActiveOffer(): Promise<PublicStoreOffer | null> {
  const row = await getActiveStoreOffer();
  if (!row) return null;
  const db = storeDb();
  let held = 0;
  if (db) {
    const { count } = await db
      .from("store_offer_holds")
      .select("id", { count: "exact", head: true })
      .eq("offer_id", row.id)
      .eq("status", "held");
    held = count || 0;
  }
  return toPublicOffer(row, new Date(), held);
}

export async function createStoreOffer(input: OfferWriteInput): Promise<StoreOfferRow> {
  const errors = validateOfferInput(input);
  if (errors.length) throw new Error(errors[0]);
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const slug = slugifyOfferName(input.slug || input.name);
  const { data, error } = await db
    .from("store_offers")
    .insert({
      name: input.name.trim(),
      slug,
      enabled: !!input.enabled,
      discount_type: input.discount_type,
      discount_value: Math.round(Number(input.discount_value)),
      starts_at: input.starts_at || null,
      ends_at: input.ends_at || null,
      max_redemptions: input.max_redemptions == null ? null : Math.round(Number(input.max_redemptions)),
      scope: input.scope,
      product_ids: input.product_ids || [],
      category_ids: input.category_ids || [],
      banner_title: input.banner_title?.trim() || null,
      banner_subtitle: input.banner_subtitle?.trim() || null,
      badge_text: input.badge_text?.trim() || null,
    })
    .select(OFFER_COLS)
    .single();
  if (error || !data) throw new Error(error?.message || "could not create offer");
  return toRow(data as Record<string, unknown>);
}

export async function updateStoreOffer(id: string, input: OfferWriteInput): Promise<StoreOfferRow> {
  const errors = validateOfferInput(input);
  if (errors.length) throw new Error(errors[0]);
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const slug = slugifyOfferName(input.slug || input.name);
  const { data, error } = await db
    .from("store_offers")
    .update({
      name: input.name.trim(),
      slug,
      enabled: !!input.enabled,
      discount_type: input.discount_type,
      discount_value: Math.round(Number(input.discount_value)),
      starts_at: input.starts_at || null,
      ends_at: input.ends_at || null,
      max_redemptions: input.max_redemptions == null ? null : Math.round(Number(input.max_redemptions)),
      scope: input.scope,
      product_ids: input.product_ids || [],
      category_ids: input.category_ids || [],
      banner_title: input.banner_title?.trim() || null,
      banner_subtitle: input.banner_subtitle?.trim() || null,
      badge_text: input.badge_text?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(OFFER_COLS)
    .single();
  if (error || !data) throw new Error(error?.message || "could not update offer");
  return toRow(data as Record<string, unknown>);
}

export async function setOfferEnabled(id: string, enabled: boolean): Promise<StoreOfferRow> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const { data, error } = await db
    .from("store_offers")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(OFFER_COLS)
    .single();
  if (error || !data) throw new Error(error?.message || "could not update offer");
  return toRow(data as Record<string, unknown>);
}

export async function duplicateStoreOffer(id: string): Promise<StoreOfferRow> {
  const src = await getStoreOfferById(id);
  if (!src) throw new Error("Offer not found");
  return createStoreOffer({
    name: `${src.name} (copy)`,
    slug: `${src.slug}-copy-${Date.now().toString(36)}`,
    enabled: false,
    discount_type: src.discount_type,
    discount_value: src.discount_value,
    starts_at: src.starts_at,
    ends_at: src.ends_at,
    max_redemptions: src.max_redemptions,
    scope: src.scope,
    product_ids: src.product_ids,
    category_ids: src.category_ids,
    banner_title: src.banner_title,
    banner_subtitle: src.banner_subtitle,
    badge_text: src.badge_text,
  });
}

export async function holdStoreOffer(opts: {
  offerId: string;
  orderId: string;
  ttlSeconds?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const db = storeDb();
  if (!db) return { ok: false, reason: "store unavailable" };
  const { data, error } = await db.rpc("store_hold_offer", {
    p_offer_id: opts.offerId,
    p_order_id: opts.orderId,
    p_ttl_seconds: opts.ttlSeconds ?? OFFER_HOLD_TTL_SECONDS,
  });
  if (error) return { ok: false, reason: error.message };
  const row = data as { ok?: boolean; reason?: string } | null;
  if (!row?.ok) return { ok: false, reason: row?.reason || "offer unavailable" };
  return { ok: true };
}

export async function consumeStoreOfferHold(orderId: string): Promise<void> {
  const db = storeDb();
  if (!db) return;
  await db.rpc("store_consume_offer_hold", { p_order_id: orderId });
}

export async function releaseStoreOfferHold(orderId: string): Promise<void> {
  const db = storeDb();
  if (!db) return;
  await db.rpc("store_release_offer_hold", { p_order_id: orderId });
}

export function offerTraceFromQuote(quote: {
  offer_id?: string | null;
  offer_name?: string | null;
  offer_slug?: string | null;
  discount_type?: StoreOfferDiscountType | null;
  discount_value?: number | null;
  discount_paise: number;
  subtotal_paise: number;
  total_paise: number;
}): Record<string, unknown> | null {
  if (!quote.offer_id || !quote.discount_paise) return null;
  return {
    offer_id: quote.offer_id,
    offer_name: quote.offer_name,
    offer_slug: quote.offer_slug,
    discount_type: quote.discount_type,
    discount_value: quote.discount_value,
    discount_amount: quote.discount_paise,
    pre_discount_total: quote.subtotal_paise,
    final_total: quote.total_paise,
  };
}
