import type { Coupon } from "./types";

export interface CouponSuccess {
  ok: true;
  coupon: Coupon;
  /** Discount amount in rupees (already clamped to the base amount). */
  discount: number;
  /** Amount payable after the discount. */
  finalAmount: number;
}
export interface CouponFailure {
  ok: false;
  error: string;
}
export type CouponResult = CouponSuccess | CouponFailure;

/**
 * Validate a coupon code against an item's coupon list + base amount.
 * Pure + server-safe: checks active flag, expiry, and usage limit.
 */
export function validateCoupon(
  coupons: Coupon[] | undefined | null,
  rawCode: string,
  baseAmount: number
): CouponResult {
  const code = (rawCode || "").trim();
  if (!code) return { ok: false, error: "Enter a coupon code." };

  const coupon = (coupons || []).find(
    (c) => (c.code || "").trim().toLowerCase() === code.toLowerCase()
  );
  if (!coupon) return { ok: false, error: "Invalid coupon code." };
  if (coupon.active === false) return { ok: false, error: "This coupon is no longer active." };
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This coupon has expired." };
  }
  if (coupon.max_uses != null && (coupon.used || 0) >= coupon.max_uses) {
    return { ok: false, error: "This coupon has reached its usage limit." };
  }

  const raw = coupon.type === "percent" ? Math.round((baseAmount * coupon.value) / 100) : coupon.value;
  const discount = Math.max(0, Math.min(Math.round(raw), baseAmount));
  return { ok: true, coupon, discount, finalAmount: Math.max(0, baseAmount - discount) };
}
