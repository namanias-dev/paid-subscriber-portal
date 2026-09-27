/**
 * Notes discount codes. Server-side only.
 * The browser may display a quote. It never supplies the discount amount.
 */
import { createHash } from "node:crypto";
import type { EventName } from "@/lib/analytics/events";
import { storeDb } from "./db";
import { storeFeatureEnabled } from "./flags";
import { normalizeIndianMobile } from "./checkoutLeadLogic";
import {
  clampDiscountHoldTtl,
  customerDiscountMessage,
  deriveDiscountStatus,
  formatIstDateTime,
  judgeDiscountCode,
  normalizeDiscountCode,
  utcIsoToIstParts,
  validateDiscountWrite,
  type DiscountCodeRule,
  type DiscountJudgement,
  type DiscountLine,
  type DiscountRejectReason,
  type DiscountScope,
  type DiscountStatus,
  type DiscountType,
} from "./discountPricing";

/** 30 minutes by default. NOTES_DISCOUNT_HOLD_TTL_SECONDS may set 15–60 minutes. */
export function discountHoldTtlSeconds(): number {
  const raw = Number(process.env.NOTES_DISCOUNT_HOLD_TTL_SECONDS);
  return clampDiscountHoldTtl(Number.isFinite(raw) && raw > 0 ? raw : undefined);
}

export type { DiscountStatus, DiscountType, DiscountScope };

const CODE_COLS =
  "id,code,name,discount_type,discount_value,scope,starts_at,expires_at,is_active,archived_at,max_redemptions,redemption_count,per_customer_limit,created_by,updated_by,created_at,updated_at";

export interface DiscountCodeRow {
  id: string;
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  scope: DiscountScope;
  product_ids: string[];
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  archived_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  per_customer_limit: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  status: DiscountStatus;
  held_count: number;
  expires_label: string | null;
  starts_label: string | null;
}

export interface DiscountWriteInput {
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  scope: DiscountScope;
  product_ids?: string[];
  starts_at?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  max_redemptions?: number | null;
  per_customer_limit?: number | null;
}

export function discountPhoneHash(phoneKey: string | null | undefined): string | null {
  const digits = normalizeIndianMobile(phoneKey);
  if (!digits) return null;
  return createHash("sha256").update(`notes-discount:${digits}`).digest("hex");
}

async function trackDiscount(name: EventName, props: Record<string, unknown>, dedupeKey: string): Promise<void> {
  try {
    const { writeEvent } = await import("@/lib/analytics/server");
    await writeEvent({ event_name: name, props, dedupe_key: dedupeKey });
  } catch { /* analytics must not block payment */ }
}

export async function discountCodesEnabled(): Promise<boolean> {
  return storeFeatureEnabled("notes_store_coupons");
}

function asRule(row: DiscountCodeRow, held: number, customerUses: number): DiscountCodeRule {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    discount_type: row.discount_type,
    discount_value: row.discount_value,
    scope: row.scope,
    product_ids: row.product_ids,
    starts_at: row.starts_at,
    expires_at: row.expires_at,
    is_active: row.is_active,
    archived_at: row.archived_at,
    max_redemptions: row.max_redemptions,
    redemption_count: row.redemption_count,
    held_count: held,
    per_customer_limit: row.per_customer_limit,
    customer_uses: customerUses,
  };
}

function toRow(raw: Record<string, unknown>, productIds: string[], held = 0): DiscountCodeRow {
  const type: DiscountType = raw.discount_type === "percentage" ? "percentage" : "fixed_amount";
  const scope: DiscountScope = raw.scope === "selected_products" ? "selected_products" : "all_notes";
  const base = {
    id: String(raw.id),
    code: String(raw.code || ""),
    name: String(raw.name || ""),
    discount_type: type,
    discount_value: Number(raw.discount_value || 0),
    scope,
    product_ids: productIds,
    starts_at: (raw.starts_at as string) || null,
    expires_at: (raw.expires_at as string) || null,
    is_active: !!raw.is_active,
    archived_at: (raw.archived_at as string) || null,
    max_redemptions: raw.max_redemptions == null ? null : Number(raw.max_redemptions),
    redemption_count: Number(raw.redemption_count || 0),
    per_customer_limit: raw.per_customer_limit == null ? null : Number(raw.per_customer_limit),
    created_by: (raw.created_by as string) || null,
    updated_by: (raw.updated_by as string) || null,
    created_at: String(raw.created_at || ""),
    updated_at: String(raw.updated_at || ""),
    held_count: held,
  };
  return {
    ...base,
    status: deriveDiscountStatus(base),
    expires_label: formatIstDateTime(base.expires_at),
    starts_label: formatIstDateTime(base.starts_at),
  };
}

async function productIdsFor(ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const db = storeDb();
  if (!db) return map;
  const { data } = await db.from("store_discount_code_products").select("discount_code_id,product_id").in("discount_code_id", ids);
  for (const row of data || []) {
    const list = map.get(row.discount_code_id) || [];
    list.push(row.product_id);
    map.set(row.discount_code_id, list);
  }
  return map;
}

async function heldCounts(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const db = storeDb();
  if (!db) return map;
  const { data } = await db
    .from("store_discount_redemptions")
    .select("discount_code_id,expires_at")
    .eq("status", "held")
    .in("discount_code_id", ids);
  const now = Date.now();
  for (const row of data || []) {
    const expires = row.expires_at ? new Date(row.expires_at).getTime() : null;
    if (expires != null && expires <= now) continue;
    map.set(row.discount_code_id, (map.get(row.discount_code_id) || 0) + 1);
  }
  return map;
}

async function customerUses(codeId: string, phoneHash: string | null): Promise<number> {
  if (!phoneHash) return 0;
  const db = storeDb();
  if (!db) return 0;
  const { count } = await db
    .from("store_discount_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("discount_code_id", codeId)
    .eq("phone_hash", phoneHash)
    .eq("status", "captured");
  return count || 0;
}

export async function getDiscountCodeByCode(code: string): Promise<DiscountCodeRow | null> {
  const normalized = normalizeDiscountCode(code);
  const db = storeDb();
  if (!normalized || !db) return null;
  const { data } = await db.from("store_discount_codes").select(CODE_COLS).eq("code", normalized).maybeSingle();
  if (!data) return null;
  const products = await productIdsFor([data.id]);
  const held = await heldCounts([data.id]);
  return toRow(data as Record<string, unknown>, products.get(data.id) || [], held.get(data.id) || 0);
}

export async function getDiscountCodeById(id: string): Promise<DiscountCodeRow | null> {
  const db = storeDb();
  if (!db || !id) return null;
  const { data } = await db.from("store_discount_codes").select(CODE_COLS).eq("id", id).maybeSingle();
  if (!data) return null;
  const products = await productIdsFor([data.id]);
  const held = await heldCounts([data.id]);
  return toRow(data as Record<string, unknown>, products.get(data.id) || [], held.get(data.id) || 0);
}

export async function listDiscountCodes(): Promise<DiscountCodeRow[]> {
  const db = storeDb();
  if (!db) return [];
  const { data, error } = await db.from("store_discount_codes").select(CODE_COLS).order("created_at", { ascending: false });
  if (error || !data?.length) return [];
  const ids = data.map((row) => row.id as string);
  const products = await productIdsFor(ids);
  const held = await heldCounts(ids);
  return data.map((row) => toRow(row as Record<string, unknown>, products.get(row.id) || [], held.get(row.id) || 0));
}

async function assertProducts(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const { data } = await db.from("store_products").select("id").in("id", ids).is("archived_at", null);
  const found = new Set((data || []).map((row) => row.id));
  if (ids.some((id) => !found.has(id))) throw new Error("One of the selected Notes products no longer exists.");
}

async function replaceProducts(codeId: string, ids: string[]): Promise<void> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  await db.from("store_discount_code_products").delete().eq("discount_code_id", codeId);
  if (!ids.length) return;
  const { error } = await db.from("store_discount_code_products").insert(ids.map((product_id) => ({ discount_code_id: codeId, product_id })));
  if (error) throw new Error("Could not save the product selection.");
}

async function audit(codeId: string, event: string, actor: string | null, payload?: Record<string, unknown>): Promise<void> {
  const db = storeDb();
  if (!db) return;
  await db.from("store_discount_code_events").insert({
    discount_code_id: codeId,
    event,
    actor,
    payload: payload || null,
  });
}

function writePayload(input: DiscountWriteInput, actor: string | null, creating: boolean) {
  return {
    code: normalizeDiscountCode(input.code),
    name: input.name.trim().slice(0, 120),
    discount_type: input.discount_type,
    discount_value: Math.round(Number(input.discount_value)),
    scope: input.scope,
    starts_at: input.starts_at || null,
    expires_at: input.expires_at || null,
    is_active: !!input.is_active,
    max_redemptions: input.max_redemptions == null ? null : Math.round(Number(input.max_redemptions)),
    per_customer_limit: input.per_customer_limit == null ? null : Math.round(Number(input.per_customer_limit)),
    updated_by: actor,
    updated_at: new Date().toISOString(),
    ...(creating ? { created_by: actor } : {}),
  };
}

export async function createDiscountCode(input: DiscountWriteInput, actor: string | null): Promise<DiscountCodeRow> {
  const productIds = [...new Set((input.product_ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const errors = validateDiscountWrite({
    code: input.code,
    name: input.name,
    discount_type: input.discount_type,
    discount_value: Math.round(Number(input.discount_value)),
    scope: input.scope,
    product_ids: productIds,
    starts_at: input.starts_at || null,
    expires_at: input.expires_at || null,
    is_active: !!input.is_active,
    max_redemptions: input.max_redemptions ?? null,
    per_customer_limit: input.per_customer_limit ?? null,
  });
  if (errors.length) throw new Error(errors[0]);
  await assertProducts(productIds);
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const payload = writePayload({ ...input, product_ids: productIds }, actor, true);
  const { data, error } = await db.from("store_discount_codes").insert(payload).select(CODE_COLS).single();
  if (error || !data) {
    if (/duplicate|unique/i.test(error?.message || "")) throw new Error("That code is already in use.");
    throw new Error("Could not create this discount code.");
  }
  await replaceProducts(data.id, input.scope === "selected_products" ? productIds : []);
  await audit(data.id, "created", actor, { code: payload.code, is_active: payload.is_active });
  const row = await getDiscountCodeById(data.id);
  if (!row) throw new Error("Could not create this discount code.");
  return row;
}

export async function updateDiscountCode(id: string, input: DiscountWriteInput, actor: string | null): Promise<DiscountCodeRow> {
  const current = await getDiscountCodeById(id);
  if (!current || current.archived_at) throw new Error("This discount code cannot be edited.");
  const productIds = [...new Set((input.product_ids || []).map((pid) => String(pid || "").trim()).filter(Boolean))];
  const errors = validateDiscountWrite({
    code: input.code,
    name: input.name,
    discount_type: input.discount_type,
    discount_value: Math.round(Number(input.discount_value)),
    scope: input.scope,
    product_ids: productIds,
    starts_at: input.starts_at || null,
    expires_at: input.expires_at || null,
    is_active: !!input.is_active,
    max_redemptions: input.max_redemptions ?? null,
    per_customer_limit: input.per_customer_limit ?? null,
    redeemed_count: current.redemption_count,
    reserved_count: current.held_count,
  });
  if (errors.length) throw new Error(errors[0]);
  await assertProducts(productIds);
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const payload = writePayload({ ...input, product_ids: productIds }, actor, false);
  const { error } = await db.from("store_discount_codes").update(payload).eq("id", id).is("archived_at", null);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error("That code is already in use.");
    throw new Error("Could not update this discount code.");
  }
  await replaceProducts(id, input.scope === "selected_products" ? productIds : []);
  const event = current.is_active !== !!input.is_active ? (input.is_active ? "activated" : "deactivated") : "updated";
  await audit(id, event, actor, { code: payload.code });
  const row = await getDiscountCodeById(id);
  if (!row) throw new Error("Could not update this discount code.");
  return row;
}

export async function archiveDiscountCode(id: string, actor: string | null): Promise<DiscountCodeRow> {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const now = new Date().toISOString();
  const { error } = await db
    .from("store_discount_codes")
    .update({ archived_at: now, is_active: false, updated_at: now, updated_by: actor })
    .eq("id", id)
    .is("archived_at", null);
  if (error) throw new Error("Could not archive this discount code.");
  await audit(id, "archived", actor);
  const row = await getDiscountCodeById(id);
  if (!row) throw new Error("Could not archive this discount code.");
  return row;
}

export interface AppliedDiscount {
  id: string;
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  scope: DiscountScope;
  discount_paise: number;
  eligible_product_ids: string[];
  eligible_paise: number;
  merchandise_before_paise: number;
}

export async function judgeCartDiscount(input: {
  rawCode: string | null | undefined;
  lines: DiscountLine[];
  phoneKey?: string | null;
  now?: Date;
}): Promise<{ applied: AppliedDiscount | null; reason: DiscountRejectReason | null; message: string | null }> {
  const code = normalizeDiscountCode(input.rawCode);
  if (!code) return { applied: null, reason: "empty", message: null };
  if (!(await discountCodesEnabled())) {
    return { applied: null, reason: "unavailable", message: "We couldn’t check this code right now. Please try again." };
  }
  try {
    const row = await getDiscountCodeByCode(code);
    if (!row) return { applied: null, reason: "invalid", message: customerDiscountMessage("invalid") };
    const uses = row.per_customer_limit != null ? await customerUses(row.id, discountPhoneHash(input.phoneKey)) : 0;
    const judged: DiscountJudgement = judgeDiscountCode(asRule(row, row.held_count, uses), input.lines, input.now || new Date());
    if (!judged.ok) return { applied: null, reason: judged.reason, message: judged.message };
    const merchandise = input.lines.reduce((sum, line) => sum + Math.max(0, Math.round(line.merchandise_paise || 0)), 0);
    return {
      applied: {
        id: row.id,
        code: row.code,
        name: row.name,
        discount_type: row.discount_type,
        discount_value: row.discount_value,
        scope: row.scope,
        discount_paise: judged.discount_paise,
        eligible_product_ids: judged.eligible_product_ids,
        eligible_paise: judged.eligible_paise,
        merchandise_before_paise: merchandise,
      },
      reason: null,
      message: null,
    };
  } catch {
    return { applied: null, reason: "unavailable", message: customerDiscountMessage("unavailable") };
  }
}

export async function recordDiscountApplication(codeId: string): Promise<void> {
  try {
    await audit(codeId, "applied", null);
  } catch { /* application analytics must not block checkout */ }
}

export async function setCartDiscountCode(cartId: string, code: string | null): Promise<void> {
  const db = storeDb();
  if (!db) return;
  await db.from("store_carts").update({ promo_code: code, updated_at: new Date().toISOString() }).eq("id", cartId).eq("status", "open");
}

export function couponSnapshot(applied: AppliedDiscount) {
  return {
    coupon_id: applied.id,
    coupon_code: applied.code,
    name: applied.name,
    discount_type: applied.discount_type,
    discount_value: applied.discount_value,
    scope: applied.scope,
    eligible_product_ids: applied.eligible_product_ids,
    eligible_paise: applied.eligible_paise,
    discount_paise: applied.discount_paise,
    merchandise_before_paise: applied.merchandise_before_paise,
    merchandise_after_paise: Math.max(0, applied.merchandise_before_paise - applied.discount_paise),
  };
}

export async function holdDiscountForOrder(input: {
  codeId: string;
  orderId: string;
  phoneKey: string | null;
  amountPaise: number;
  customerId?: string | null;
  couponCode?: string | null;
}): Promise<{ ok: boolean; reason: DiscountRejectReason | null }> {
  const db = storeDb();
  if (!db) return { ok: false, reason: "unavailable" };
  const { data, error } = await db.rpc("store_hold_discount_code", {
    p_code_id: input.codeId,
    p_order_id: input.orderId,
    p_phone_hash: discountPhoneHash(input.phoneKey),
    p_amount: input.amountPaise,
    p_ttl_seconds: discountHoldTtlSeconds(),
    p_customer_id: input.customerId || null,
  });
  if (error) return { ok: false, reason: "unavailable" };
  const row = data as { ok?: boolean; reason?: string; already?: string; changed?: boolean } | null;
  if (row?.ok) {
    if (row.changed && input.couponCode) {
      void trackDiscount(
        "notes_discount_payment_reserved",
        { coupon_code: input.couponCode, discount_amount: input.amountPaise },
        `notes_discount_payment_reserved:${input.orderId}`,
      );
    }
    return { ok: true, reason: null };
  }
  const reason = row?.reason;
  if (reason === "expired" || reason === "limit" || reason === "customer_limit" || reason === "customer_pending") {
    return { ok: false, reason };
  }
  if (reason === "unavailable") return { ok: false, reason: "unavailable" };
  return { ok: false, reason: "invalid" };
}

export async function captureDiscountForOrder(orderId: string): Promise<void> {
  const db = storeDb();
  if (!db) return;
  try {
    const { data } = await db.rpc("store_capture_discount_code", { p_order_id: orderId });
    const row = data as { changed?: boolean; coupon_code?: string; discount_amount?: number } | null;
    if (row?.changed && row.coupon_code) {
      void trackDiscount(
        "notes_discount_redeemed",
        { coupon_code: row.coupon_code, discount_amount: row.discount_amount || 0 },
        `notes_discount_redeemed:${orderId}`,
      );
    }
  } catch { /* a capture bookkeeping failure must not undo a paid order */ }
}

export async function releaseDiscountForOrder(orderId: string): Promise<void> {
  const db = storeDb();
  if (!db) return;
  try {
    const { data } = await db.rpc("store_release_discount_code", { p_order_id: orderId });
    const row = data as { changed?: boolean; coupon_code?: string; discount_amount?: number } | null;
    if (row?.changed && row.coupon_code) {
      void trackDiscount(
        "notes_discount_reservation_released",
        { coupon_code: row.coupon_code, discount_amount: row.discount_amount || 0, reason: "payment_failed" },
        `notes_discount_reservation_released:${orderId}`,
      );
    }
  } catch { /* releasing a slot must not change the payment outcome */ }
}

export async function releaseExpiredDiscountHolds(): Promise<void> {
  const db = storeDb();
  if (!db) return;
  try {
    const { data } = await db.rpc("store_release_expired_discount_holds");
    const row = data as { released?: Array<{ order_id?: string; coupon_code?: string; discount_amount?: number }> } | null;
    for (const item of row?.released || []) {
      if (!item?.order_id || !item.coupon_code) continue;
      void trackDiscount(
        "notes_discount_reservation_released",
        { coupon_code: item.coupon_code, discount_amount: item.discount_amount || 0, reason: "expired" },
        `notes_discount_reservation_released:${item.order_id}`,
      );
    }
  } catch { /* the verify sweep must continue */ }
}

export function publicDiscountSummary(applied: AppliedDiscount) {
  return {
    code: applied.code,
    discount_paise: applied.discount_paise,
    discount_type: applied.discount_type,
    eligible_product_ids: applied.eligible_product_ids,
    merchandise_before_paise: applied.merchandise_before_paise,
    merchandise_after_paise: Math.max(0, applied.merchandise_before_paise - applied.discount_paise),
  };
}

export function istPartsForAdmin(row: DiscountCodeRow) {
  return {
    starts: utcIsoToIstParts(row.starts_at),
    expires: utcIsoToIstParts(row.expires_at),
  };
}
