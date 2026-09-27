/**
 * Checkout leads. Fail-open: every export swallows errors so cart, checkout,
 * and payment keep working when this table or the insert is unavailable.
 */
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { storeDb } from "./db";
import { getCartView, writeCartId, type CartView } from "./cart";
import { requestLeadAttribution } from "@/lib/marketing/requestAttribution";
import { businessChannel, isQaState } from "@/lib/analytics/notesCommerce";
import { SESSION_COOKIE, VISITOR_COOKIE } from "@/lib/attribution";
import { judgeCartDiscount } from "./discountCodes";
import {
  completeAddress,
  isOpenStage,
  leadAllowsPromo,
  leadAnalyticsProps,
  nextAbandonedStage,
  normalizeIndianMobile,
  shouldCreateLead,
  shouldRetainForPurge,
  stageForDraft,
  summarizeCheckoutLeads,
  type CheckoutStage,
  type LeadAddress,
  type LeadCartLine,
  type SalesStatus,
} from "./checkoutLeadLogic";

export const LEAD_COOKIE = "nias_checkout_lead";
const LEAD_COOKIE_SECONDS = 14 * 24 * 60 * 60;

export interface CheckoutLeadDraft {
  name: string | null;
  phone: string;
  email: string | null;
  marketing_consent: boolean;
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: LEAD_COOKIE_SECONDS,
  };
}

function readLeadCookie(): string | null {
  return cookies().get(LEAD_COOKIE)?.value || null;
}

function writeLeadCookie(id: string): void {
  cookies().set(LEAD_COOKIE, id, cookieOpts());
}

function snapshot(cart: CartView): { lines: LeadCartLine[]; value: number } {
  const lines = cart.items.map((item) => ({
    product_id: item.product_id,
    sku: item.product.sku,
    name: item.product.name,
    qty: item.qty,
    line_total_paise: item.line_total_paise,
  }));
  return { lines, value: cart.subtotal_paise };
}

async function emit(name: "notes_checkout_lead_created" | "notes_checkout_contact_captured" | "notes_checkout_abandoned" | "notes_checkout_lead_converted" | "notes_checkout_recovered", leadId: string, props: Record<string, unknown>): Promise<void> {
  try {
    const { writeEvent } = await import("@/lib/analytics/server");
    await writeEvent({
      event_name: name,
      dedupe_key: `${name}:${leadId}`,
      props,
    });
  } catch { /* analytics must not block checkout */ }
}

export async function saveCheckoutLead(input: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  marketingConsent?: boolean;
  address?: Partial<LeadAddress> | null;
  addressConfirmed?: boolean;
}): Promise<{ ok: true; skipped?: string }> {
  try {
    const phone = normalizeIndianMobile(input.phone);
    const cart = await getCartView();
    if (!shouldCreateLead(phone, cart?.item_count || 0) || !cart || !phone) return { ok: true, skipped: "no_contact" };
    const db = storeDb();
    if (!db) return { ok: true, skipped: "unavailable" };
    const address = completeAddress(input.address);
    const stage = stageForDraft({ name: input.name, address });
    const snap = snapshot(cart);
    let couponCode: string | null = null;
    let couponDiscount = 0;
    let beforeDiscount = snap.lines.reduce((sum, line) => sum + Math.max(0, Number(line.line_total_paise) || 0), 0);
    let afterDiscount = beforeDiscount;
    try {
      if (cart.discount_code) {
        const judged = await judgeCartDiscount({
          rawCode: cart.discount_code,
          lines: cart.items.map((item) => ({ product_id: item.product_id, merchandise_paise: item.line_total_paise })),
          phoneKey: phone,
        });
        if (judged.applied) {
          couponCode = judged.applied.code;
          couponDiscount = judged.applied.discount_paise;
          beforeDiscount = judged.applied.merchandise_before_paise;
          afterDiscount = Math.max(0, beforeDiscount - couponDiscount);
        }
      }
    } catch { /* lead capture must not depend on the discount service */ }
    const attr = requestLeadAttribution();
    const touch = attr.attribution?.last_touch || attr.attribution?.first_touch || null;
    const now = new Date().toISOString();
    const jar = cookies();
    const visitorId = jar.get(VISITOR_COOKIE)?.value || null;
    const sessionId = jar.get(SESSION_COOKIE)?.value || null;
    const consent = input.marketingConsent === true;
    const email = (input.email || "").trim();
    const safeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 160) : null;
    const name = (input.name || "").trim().slice(0, 120) || null;

    const { data: byPhone } = await db
      .from("store_checkout_leads")
      .select("id,checkout_stage,sales_status,marketing_consent,was_abandoned,last_activity_at")
      .eq("phone_key", phone)
      .not("checkout_stage", "in", "(CONVERTED,EXPIRED)")
      .limit(1)
      .maybeSingle();

    let existing = byPhone;
    if (!existing) {
      const cookieId = readLeadCookie();
      if (cookieId) {
        const { data: byCookie } = await db
          .from("store_checkout_leads")
          .select("id,checkout_stage,sales_status,marketing_consent,was_abandoned,last_activity_at")
          .eq("id", cookieId)
          .not("checkout_stage", "in", "(CONVERTED,EXPIRED)")
          .maybeSingle();
        existing = byCookie;
      }
    }

    const patch: Record<string, unknown> = {
      phone,
      name,
      email: safeEmail,
      cart_id: cart.id,
      cart_snapshot: snap.lines,
      cart_value_paise: snap.value,
      checkout_stage: stage,
      attribution_json: attr.attribution,
      landing_path: attr.landing_page_path,
      visitor_id: visitorId,
      session_id: sessionId,
      address_snapshot: address,
      address_confirmed: input.addressConfirmed === true,
      ...(couponCode
        ? {
            coupon_code: couponCode,
            coupon_discount_paise: couponDiscount,
            cart_before_discount_paise: beforeDiscount,
            cart_after_discount_paise: afterDiscount,
          }
        : {}),
      is_test: isQaState(attr.attribution),
      last_activity_at: now,
      updated_at: now,
    };
    if (consent) {
      patch.marketing_consent = true;
      patch.marketing_consent_at = now;
      patch.marketing_consent_source = "checkout_checkbox";
    } else if (!existing?.marketing_consent) {
      patch.marketing_consent = false;
    }

    if (existing && isOpenStage(existing.checkout_stage as CheckoutStage)) {
      const abandoned = nextAbandonedStage(existing.checkout_stage as CheckoutStage, existing.last_activity_at, new Date());
      if (abandoned || existing.was_abandoned) patch.was_abandoned = true;
      if (existing.sales_status === "DO_NOT_CONTACT") delete patch.checkout_stage;
      const { error } = await db.from("store_checkout_leads").update(patch).eq("id", existing.id);
      if (error && couponCode) {
        delete patch.coupon_code;
        delete patch.coupon_discount_paise;
        delete patch.cart_before_discount_paise;
        delete patch.cart_after_discount_paise;
        const retry = await db.from("store_checkout_leads").update(patch).eq("id", existing.id);
        if (retry.error) return { ok: true, skipped: "update_failed" };
      } else if (error) return { ok: true, skipped: "update_failed" };
      writeLeadCookie(existing.id);
      return { ok: true };
    }

    const { data: inserted, error } = await db
      .from("store_checkout_leads")
      .insert({ ...patch, sales_status: "NEW", was_abandoned: false, created_at: now })
      .select("id")
      .single();
    if (error || !inserted) {
      const { data: again } = await db
        .from("store_checkout_leads")
        .select("id")
        .eq("phone_key", phone)
        .not("checkout_stage", "in", "(CONVERTED,EXPIRED)")
        .limit(1)
        .maybeSingle();
      if (!again) return { ok: true, skipped: "insert_failed" };
      await db.from("store_checkout_leads").update(patch).eq("id", again.id);
      writeLeadCookie(again.id);
      return { ok: true };
    }
    writeLeadCookie(inserted.id);
    const props = leadAnalyticsProps({
      leadId: inserted.id,
      stage,
      cartValuePaise: snap.value,
      itemCount: snap.lines.length,
      channel: businessChannel(touch),
      isTest: isQaState(attr.attribution),
    });
    void emit("notes_checkout_lead_created", inserted.id, props);
    void emit("notes_checkout_contact_captured", inserted.id, props);
    return { ok: true };
  } catch {
    return { ok: true, skipped: "error" };
  }
}

export async function readCheckoutLeadDraft(): Promise<CheckoutLeadDraft | null> {
  try {
    const id = readLeadCookie();
    if (!id) return null;
    const db = storeDb();
    if (!db) return null;
    const { data } = await db
      .from("store_checkout_leads")
      .select("name,phone,email,marketing_consent,checkout_stage")
      .eq("id", id)
      .maybeSingle();
    if (!data || data.checkout_stage === "CONVERTED" || data.checkout_stage === "EXPIRED") return null;
    return {
      name: data.name,
      phone: data.phone,
      email: data.email,
      marketing_consent: Boolean(data.marketing_consent),
    };
  } catch {
    return null;
  }
}

export async function markLeadPaymentInitiated(input: {
  phone: string;
  name: string;
  email?: string | null;
  cartId: string;
  orderId: string;
  totalPaise: number;
}): Promise<void> {
  try {
    const phone = normalizeIndianMobile(input.phone);
    const db = storeDb();
    if (!db || !phone) return;
    const now = new Date().toISOString();
    const { data: lines } = await db
      .from("store_order_items")
      .select("product_id,sku_snapshot,name_snapshot,qty,line_total_paise")
      .eq("order_id", input.orderId);
    const cartSnapshot = (lines || []).map((line) => ({
      product_id: line.product_id,
      sku: line.sku_snapshot,
      name: line.name_snapshot,
      qty: line.qty,
      line_total_paise: line.line_total_paise,
    }));
    const patch = {
      checkout_stage: "PAYMENT_INITIATED",
      order_id: input.orderId,
      cart_id: input.cartId,
      cart_value_paise: input.totalPaise,
      cart_snapshot: cartSnapshot,
      name: (input.name || "").trim().slice(0, 120) || null,
      last_activity_at: now,
      updated_at: now,
    };
    const { data: existing } = await db
      .from("store_checkout_leads")
      .select("id,sales_status")
      .eq("phone_key", phone)
      .not("checkout_stage", "in", "(CONVERTED,EXPIRED)")
      .limit(1)
      .maybeSingle();
    if (existing) {
      await db.from("store_checkout_leads").update(patch).eq("id", existing.id);
      writeLeadCookie(existing.id);
      return;
    }
    const attr = requestLeadAttribution();
    const jar = cookies();
    const { data: inserted } = await db.from("store_checkout_leads").insert({
      ...patch,
      phone,
      email: (input.email || "").trim() || null,
      sales_status: "NEW",
      was_abandoned: false,
      attribution_json: attr.attribution,
      landing_path: attr.landing_page_path,
      visitor_id: jar.get(VISITOR_COOKIE)?.value || null,
      session_id: jar.get(SESSION_COOKIE)?.value || null,
      is_test: isQaState(attr.attribution),
      created_at: now,
    }).select("id").single();
    if (!inserted) return;
    writeLeadCookie(inserted.id);
    const touch = attr.attribution?.last_touch || attr.attribution?.first_touch || null;
    const props = leadAnalyticsProps({
      leadId: inserted.id,
      stage: "PAYMENT_INITIATED",
      cartValuePaise: input.totalPaise,
      itemCount: cartSnapshot.length,
      channel: businessChannel(touch),
      isTest: isQaState(attr.attribution),
    });
    void emit("notes_checkout_lead_created", inserted.id, props);
    void emit("notes_checkout_contact_captured", inserted.id, props);
  } catch { /* payment already started */ }
}

export async function markLeadConverted(orderId: string, totalPaise: number): Promise<void> {
  try {
    const db = storeDb();
    if (!db) return;
    const { data } = await db
      .from("store_checkout_leads")
      .select("id,was_abandoned,checkout_stage,cart_value_paise,cart_snapshot,is_test,attribution_json,sales_status")
      .eq("order_id", orderId)
      .neq("checkout_stage", "CONVERTED")
      .limit(1)
      .maybeSingle();
    if (!data) return;
    const now = new Date().toISOString();
    const sales = data.sales_status === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : "CONVERTED";
    await db.from("store_checkout_leads").update({
      checkout_stage: "CONVERTED",
      sales_status: sales,
      converted_at: now,
      converted_value_paise: totalPaise,
      updated_at: now,
      last_activity_at: now,
    }).eq("id", data.id);
    const touch = data.attribution_json?.last_touch || data.attribution_json?.first_touch || null;
    const props = leadAnalyticsProps({
      leadId: data.id,
      stage: "CONVERTED",
      cartValuePaise: totalPaise,
      itemCount: Array.isArray(data.cart_snapshot) ? data.cart_snapshot.length : 0,
      channel: businessChannel(touch),
      isTest: Boolean(data.is_test),
      recovered: Boolean(data.was_abandoned),
    });
    void emit("notes_checkout_lead_converted", data.id, props);
    if (data.was_abandoned) void emit("notes_checkout_recovered", data.id, props);
    void import("@/lib/telegram/notesLeadAlert")
      .then((alerts) => alerts.enqueueLeadConvertedAlert(data.id))
      .catch(() => {});
  } catch { /* capture already committed */ }
}

export async function sweepCheckoutLeads(now = new Date()): Promise<void> {
  try {
    const db = storeDb();
    if (!db) return;
    const { data } = await db
      .from("store_checkout_leads")
      .select("id,checkout_stage,last_activity_at,sales_status,order_id,cart_value_paise,cart_snapshot,is_test,attribution_json")
      .not("checkout_stage", "in", "(CONVERTED,EXPIRED,CHECKOUT_ABANDONED,PAYMENT_ABANDONED)")
      .lt("last_activity_at", new Date(now.getTime() - CHECKOUT_IDLE_FLOOR).toISOString())
      .limit(80);
    for (const row of data || []) {
      const next = nextAbandonedStage(row.checkout_stage as CheckoutStage, row.last_activity_at, now);
      if (!next) continue;
      await db.from("store_checkout_leads").update({
        checkout_stage: next,
        was_abandoned: true,
        updated_at: now.toISOString(),
      }).eq("id", row.id).eq("checkout_stage", row.checkout_stage);
      const touch = row.attribution_json?.last_touch || row.attribution_json?.first_touch || null;
      void emit("notes_checkout_abandoned", row.id, leadAnalyticsProps({
        leadId: row.id,
        stage: next,
        cartValuePaise: row.cart_value_paise || 0,
        itemCount: Array.isArray(row.cart_snapshot) ? row.cart_snapshot.length : 0,
        channel: businessChannel(touch),
        isTest: Boolean(row.is_test),
      }));
    }
    const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await db
      .from("store_checkout_leads")
      .select("id,checkout_stage,sales_status,last_activity_at,order_id")
      .lt("last_activity_at", cutoff)
      .is("redacted_at", null)
      .neq("checkout_stage", "CONVERTED")
      .limit(40);
    for (const row of stale || []) {
      if (!shouldRetainForPurge({
        stage: row.checkout_stage as CheckoutStage,
        salesStatus: row.sales_status as SalesStatus,
        lastActivityAt: row.last_activity_at,
        now,
        hasOrder: Boolean(row.order_id),
      })) continue;
      await db.from("store_checkout_leads").update({
        name: null,
        email: null,
        address_snapshot: null,
        checkout_stage: "EXPIRED",
        redacted_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq("id", row.id);
    }
  } catch { /* admin list still renders */ }
}

const CHECKOUT_IDLE_FLOOR = 2 * 60 * 60 * 1000;

export async function listCheckoutLeads(filter: string): Promise<Array<Record<string, unknown>>> {
  const db = storeDb();
  if (!db) return [];
  await sweepCheckoutLeads();
  const baseCols = "id,name,phone,email,cart_snapshot,cart_value_paise,checkout_stage,sales_status,was_abandoned,landing_path,attribution_json,marketing_consent,marketing_consent_at,address_snapshot,order_id,converted_at,converted_value_paise,sales_note,is_test,last_activity_at,created_at";
  const load = (cols: string) => {
    let query = db.from("store_checkout_leads").select(cols).order("last_activity_at", { ascending: false }).limit(100);
    if (filter === "abandoned") query = query.in("checkout_stage", ["CHECKOUT_ABANDONED", "PAYMENT_ABANDONED"]);
    else if (filter === "payment") query = query.in("checkout_stage", ["PAYMENT_INITIATED", "PAYMENT_ABANDONED"]);
    else if (filter === "converted") query = query.eq("checkout_stage", "CONVERTED");
    else if (filter !== "all") query = query.not("checkout_stage", "in", "(CONVERTED,EXPIRED)");
    return query;
  };
  const first = await load(`${baseCols},coupon_code,coupon_discount_paise,cart_before_discount_paise,cart_after_discount_paise`);
  if (!first.error) return (first.data || []) as unknown as Array<Record<string, unknown>>;
  const second = await load(baseCols);
  return (second.data || []) as unknown as Array<Record<string, unknown>>;
}

export async function updateCheckoutLeadSales(id: string, salesStatus: SalesStatus, note?: string): Promise<boolean> {
  const db = storeDb();
  if (!db) return false;
  const patch: Record<string, unknown> = { sales_status: salesStatus, updated_at: new Date().toISOString() };
  if (typeof note === "string") patch.sales_note = note.slice(0, 500);
  if (salesStatus === "CONVERTED") {
    /* sales converted does not invent a paid order */
  }
  const { error } = await db.from("store_checkout_leads").update(patch).eq("id", id);
  return !error;
}

export async function issueRecoveryLink(id: string): Promise<string | null> {
  const db = storeDb();
  if (!db) return null;
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const { error } = await db.from("store_checkout_leads").update({
    recovery_token_hash: hash,
    updated_at: new Date().toISOString(),
  }).eq("id", id).neq("checkout_stage", "CONVERTED");
  if (error) return null;
  return `https://www.namanias.com/api/notes/checkout-lead/recover?t=${token}`;
}

export async function recoverCheckoutLead(token: string): Promise<boolean> {
  try {
    const db = storeDb();
    if (!db || !token) return false;
    const hash = createHash("sha256").update(token).digest("hex");
    const { data } = await db
      .from("store_checkout_leads")
      .select("id,cart_id,checkout_stage")
      .eq("recovery_token_hash", hash)
      .maybeSingle();
    if (!data || data.checkout_stage === "CONVERTED" || data.checkout_stage === "EXPIRED") return false;
    writeLeadCookie(data.id);
    if (data.cart_id) {
      const { data: cart } = await db.from("store_carts").select("id,status").eq("id", data.cart_id).maybeSingle();
      if (cart?.status === "open") writeCartId(cart.id);
    }
    await db.from("store_checkout_leads").update({
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      checkout_stage: data.checkout_stage === "CHECKOUT_ABANDONED" || data.checkout_stage === "PAYMENT_ABANDONED"
        ? "DETAILS_IN_PROGRESS"
        : data.checkout_stage,
    }).eq("id", data.id);
    return true;
  } catch {
    return false;
  }
}

export async function loadCheckoutLeadReport(start: Date, end: Date) {
  const empty = summarizeCheckoutLeads([], start, end);
  try {
    const db = storeDb();
    if (!db) return empty;
    const { data, error } = await db
      .from("store_checkout_leads")
      .select("created_at,converted_at,checkout_stage,was_abandoned,is_test,converted_value_paise,attribution_json")
      .gte("created_at", new Date(start.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString())
      .limit(2000);
    if (error || !data) return empty;
    const facts = data.map((row) => {
      const touch = row.attribution_json?.last_touch || row.attribution_json?.first_touch || null;
      return {
        created_at: row.created_at,
        converted_at: row.converted_at,
        checkout_stage: row.checkout_stage as CheckoutStage,
        was_abandoned: Boolean(row.was_abandoned),
        is_test: Boolean(row.is_test),
        converted_value_paise: row.converted_value_paise,
        attribution_source: businessChannel(touch),
      };
    });
    return summarizeCheckoutLeads(facts, start, end);
  } catch {
    return empty;
  }
}

export { leadAllowsPromo };
