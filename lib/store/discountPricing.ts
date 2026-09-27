/**
 * Notes discount codes — pure pricing. Integer paise only.
 *
 * Catalog selling price and automatic store_offers stay upstream.
 * A code discounts the eligible post-offer merchandise once per order.
 * It never discounts shipping, and it never drives a total below zero.
 */

export type DiscountType = "fixed_amount" | "percentage";
export type DiscountScope = "all_notes" | "selected_products";
export type DiscountStatus = "scheduled" | "active" | "expired" | "inactive" | "archived";

export type DiscountRejectReason =
  | "empty"
  | "invalid"
  | "expired"
  | "not_applicable"
  | "limit"
  | "customer_limit"
  | "unavailable";

export interface DiscountCodeRule {
  id: string;
  code: string;
  name: string;
  discount_type: DiscountType;
  /** Paise for fixed_amount. Whole percent for percentage. */
  discount_value: number;
  scope: DiscountScope;
  product_ids: string[];
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  archived_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  held_count: number;
  per_customer_limit: number | null;
  customer_uses: number;
}

export interface DiscountLine {
  product_id: string;
  /** Merchandise after the automatic offer, before this code. */
  merchandise_paise: number;
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function normalizeDiscountCode(raw: string | null | undefined): string | null {
  const code = String(raw || "").trim().toUpperCase();
  if (!code || !CODE_RE.test(code)) return null;
  return code;
}

export function customerDiscountMessage(reason: DiscountRejectReason, code?: string | null): string {
  if (reason === "expired") return "This offer has expired.";
  if (reason === "not_applicable") {
    return code ? `${code} no longer applies to your cart.` : "This code doesn’t apply to the items in your cart.";
  }
  if (reason === "limit" || reason === "customer_limit") return "This offer has reached its usage limit.";
  if (reason === "unavailable") return "We couldn’t check this code right now. Please try again.";
  return "This code isn’t valid.";
}

export function deriveDiscountStatus(
  code: Pick<DiscountCodeRule, "is_active" | "archived_at" | "starts_at" | "expires_at">,
  now: Date = new Date(),
): DiscountStatus {
  if (code.archived_at) return "archived";
  const t = now.getTime();
  const expires = code.expires_at ? new Date(code.expires_at).getTime() : null;
  if (expires != null && Number.isFinite(expires) && t >= expires) return "expired";
  if (!code.is_active) return "inactive";
  const starts = code.starts_at ? new Date(code.starts_at).getTime() : null;
  if (starts != null && Number.isFinite(starts) && t < starts) return "scheduled";
  return "active";
}

export function discountLiveForCheckout(code: DiscountCodeRule, now: Date): DiscountRejectReason | null {
  if (code.archived_at || !code.is_active) return "invalid";
  const t = now.getTime();
  const starts = code.starts_at ? new Date(code.starts_at).getTime() : null;
  if (starts != null && Number.isFinite(starts) && t < starts) return "invalid";
  const expires = code.expires_at ? new Date(code.expires_at).getTime() : null;
  if (expires != null && Number.isFinite(expires) && t >= expires) return "expired";
  if (code.max_redemptions != null) {
    const used = Math.max(0, code.redemption_count) + Math.max(0, code.held_count);
    if (used >= code.max_redemptions) return "limit";
  }
  if (code.per_customer_limit != null && code.customer_uses >= code.per_customer_limit) return "customer_limit";
  return null;
}

export function eligibleMerchandise(lines: DiscountLine[], code: Pick<DiscountCodeRule, "scope" | "product_ids">): {
  product_ids: string[];
  paise: number;
} {
  const selected = new Set(code.product_ids);
  const ids: string[] = [];
  let paise = 0;
  for (const line of lines) {
    const amount = Math.max(0, Math.round(line.merchandise_paise || 0));
    if (amount <= 0) continue;
    const eligible = code.scope === "all_notes" || selected.has(line.product_id);
    if (!eligible) continue;
    ids.push(line.product_id);
    paise += amount;
  }
  return { product_ids: ids, paise };
}

/** Fixed amount or percentage, once, capped at the eligible merchandise. */
export function couponDiscountPaise(
  eligiblePaise: number,
  code: Pick<DiscountCodeRule, "discount_type" | "discount_value">,
): number {
  const base = Math.max(0, Math.round(eligiblePaise || 0));
  if (base <= 0) return 0;
  const value = Math.round(Number(code.discount_value) || 0);
  if (value <= 0) return 0;
  if (code.discount_type === "percentage") {
    const percent = Math.min(100, value);
    return Math.min(base, Math.round((base * percent) / 100));
  }
  return Math.min(base, value);
}

export interface DiscountJudgement {
  ok: boolean;
  reason: DiscountRejectReason | null;
  message: string | null;
  discount_paise: number;
  eligible_product_ids: string[];
  eligible_paise: number;
}

export function judgeDiscountCode(
  code: DiscountCodeRule,
  lines: DiscountLine[],
  now: Date = new Date(),
): DiscountJudgement {
  const blocked = discountLiveForCheckout(code, now);
  if (blocked) {
    return {
      ok: false,
      reason: blocked,
      message: customerDiscountMessage(blocked === "not_applicable" ? blocked : blocked, code.code),
      discount_paise: 0,
      eligible_product_ids: [],
      eligible_paise: 0,
    };
  }
  const eligible = eligibleMerchandise(lines, code);
  if (eligible.paise <= 0) {
    return {
      ok: false,
      reason: "not_applicable",
      message: "This code doesn’t apply to the items in your cart.",
      discount_paise: 0,
      eligible_product_ids: [],
      eligible_paise: 0,
    };
  }
  return {
    ok: true,
    reason: null,
    message: null,
    discount_paise: couponDiscountPaise(eligible.paise, code),
    eligible_product_ids: eligible.product_ids,
    eligible_paise: eligible.paise,
  };
}

/** Largest-remainder split. Sum never exceeds the merchandise or the discount. */
export function allocateDiscountPaise(lines: DiscountLine[], discountPaise: number): Record<string, number> {
  const eligible = lines
    .map((line) => ({ id: line.product_id, paise: Math.max(0, Math.round(line.merchandise_paise || 0)) }))
    .filter((line) => line.paise > 0);
  const total = eligible.reduce((sum, line) => sum + line.paise, 0);
  const discount = Math.min(Math.max(0, Math.round(discountPaise || 0)), total);
  const out: Record<string, number> = {};
  if (!discount || !total) return out;
  let assigned = 0;
  const remainders = eligible.map((line) => {
    const exact = (discount * line.paise) / total;
    const floor = Math.floor(exact);
    assigned += floor;
    return { id: line.id, floor, frac: exact - floor, cap: line.paise };
  });
  let left = discount - assigned;
  remainders.sort((a, b) => b.frac - a.frac || b.cap - a.cap);
  for (const row of remainders) {
    const extra = left > 0 && row.floor < row.cap ? 1 : 0;
    if (extra) left -= 1;
    out[row.id] = row.floor + extra;
  }
  return out;
}

export function settledOrderMoney(input: {
  subtotalPaise: number;
  offerDiscountPaise: number;
  couponDiscountPaise: number;
  taxPaise: number;
  shippingPaise: number;
}): { discountPaise: number; totalPaise: number } {
  const subtotal = Math.max(0, Math.round(input.subtotalPaise || 0));
  const offer = Math.min(subtotal, Math.max(0, Math.round(input.offerDiscountPaise || 0)));
  const merchandise = subtotal - offer;
  const coupon = Math.min(merchandise, Math.max(0, Math.round(input.couponDiscountPaise || 0)));
  const tax = Math.max(0, Math.round(input.taxPaise || 0));
  const shipping = Math.max(0, Math.round(input.shippingPaise || 0));
  return {
    discountPaise: offer + coupon,
    totalPaise: merchandise - coupon + tax + shipping,
  };
}

/** A repeated capture must not increment. A held, released, or missing row may. */
export function redemptionCaptureIncrements(status: "held" | "captured" | "released" | "missing"): boolean {
  return status !== "captured";
}

export function istLocalToUtcIso(date: string, time: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const clock = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!day || !clock) return null;
  const year = Number(day[1]);
  const month = Number(day[2]);
  const dateNum = Number(day[3]);
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (month < 1 || month > 12 || dateNum < 1 || dateNum > 31 || hour > 23 || minute > 59) return null;
  const utc = Date.UTC(year, month - 1, dateNum, hour, minute) - IST_OFFSET_MS;
  const result = new Date(utc);
  if (!Number.isFinite(result.getTime())) return null;
  return result.toISOString();
}

export function utcIsoToIstParts(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  const shifted = new Date(parsed.getTime() + IST_OFFSET_MS);
  const date = shifted.toISOString().slice(0, 10);
  const time = shifted.toISOString().slice(11, 16);
  return { date, time };
}

export function formatIstDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(parsed);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const minute = pick("minute");
  const dayPeriod = pick("dayPeriod").toUpperCase();
  return `${pick("day")} ${pick("month")} ${pick("year")} · ${pick("hour")}:${minute} ${dayPeriod} IST`;
}

export function validateDiscountWrite(input: {
  code: string;
  name: string;
  discount_type: string;
  discount_value: number;
  scope: string;
  product_ids: string[];
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  now?: Date;
}): string[] {
  const errors: string[] = [];
  if (!normalizeDiscountCode(input.code)) errors.push("Use 2–32 letters, numbers, hyphens, or underscores.");
  if (!String(input.name || "").trim()) errors.push("Internal name is required.");
  if (input.discount_type !== "fixed_amount" && input.discount_type !== "percentage") {
    errors.push("Discount type must be a fixed amount or a percentage.");
  }
  const value = Math.round(Number(input.discount_value));
  if (!Number.isFinite(value) || value <= 0) errors.push("Discount must be greater than 0.");
  if (input.discount_type === "percentage" && value > 100) errors.push("Percentage cannot exceed 100.");
  if (input.discount_type === "fixed_amount" && value < 100) errors.push("Fixed discount must be at least ₹1.");
  if (input.scope !== "all_notes" && input.scope !== "selected_products") errors.push("Choose which Notes this code applies to.");
  if (input.scope === "selected_products" && input.product_ids.length === 0) errors.push("Select at least one Notes product.");
  if (input.max_redemptions != null) {
    const cap = Math.round(Number(input.max_redemptions));
    if (!Number.isFinite(cap) || cap < 1) errors.push("Maximum redemptions must be at least 1, or left blank.");
  }
  if (input.per_customer_limit != null) {
    const cap = Math.round(Number(input.per_customer_limit));
    if (!Number.isFinite(cap) || cap < 1) errors.push("Per-customer limit must be at least 1, or left off.");
  }
  const start = input.starts_at ? new Date(input.starts_at).getTime() : null;
  const end = input.expires_at ? new Date(input.expires_at).getTime() : null;
  if (input.starts_at && (start == null || !Number.isFinite(start))) errors.push("Start time is not valid.");
  if (input.expires_at && (end == null || !Number.isFinite(end))) errors.push("Expiry time is not valid.");
  if (start != null && end != null && end <= start) errors.push("Expiry must be after the start time.");
  const now = (input.now || new Date()).getTime();
  if (input.is_active && end != null && end <= now && (start == null || start <= now)) {
    errors.push("Expiry must be in the future for an active code.");
  }
  return errors;
}
