import { getCartView } from "@/lib/store/cart";
import { discountCodesEnabled, judgeCartDiscount, publicDiscountSummary, setCartDiscountCode } from "@/lib/store/discountCodes";
import { customerDiscountMessage, normalizeDiscountCode } from "@/lib/store/discountPricing";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { clientIp, storeRateLimited } from "@/lib/store/rateLimit";
import { formatPaise } from "@/lib/store/money";

export const dynamic = "force-dynamic";

async function track(name: "notes_discount_applied" | "notes_discount_rejected" | "notes_discount_removed", props: Record<string, unknown>) {
  try {
    const { writeEvent } = await import("@/lib/analytics/server");
    await writeEvent({ event_name: name, props });
  } catch { /* analytics must not block checkout */ }
}

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const enabled = await discountCodesEnabled();
  if (!enabled) return noStoreJson({ ok: true, enabled: false, valid: false });

  let body: { code?: string; action?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = body.action === "remove" || body.action === "status" ? body.action : "apply";
  const cart = await getCartView();
  if (!cart) return noStoreJson({ ok: true, enabled: true, valid: false, message: "Your cart is empty." });

  if (action === "remove") {
    const previous = cart.discount_code;
    await setCartDiscountCode(cart.id, null);
    if (previous) {
      void track("notes_discount_removed", { coupon_code: previous, product_ids: cart.items.map((item) => item.product_id) });
    }
    return noStoreJson({ ok: true, enabled: true, valid: false, removed: true });
  }

  if (action === "apply") {
    const ip = clientIp(req);
    if (await storeRateLimited(`notes-discount:${ip}`, 30, 10 * 60)) {
      return noStoreJson({ ok: true, enabled: true, valid: false, reason: "unavailable", message: customerDiscountMessage("unavailable") }, 429);
    }
    const normalized = normalizeDiscountCode(body.code);
    if (!normalized) {
      return noStoreJson({ ok: true, enabled: true, valid: false, reason: "invalid", message: customerDiscountMessage("invalid") });
    }
    const judged = await judgeCartDiscount({
      rawCode: normalized,
      lines: cart.items.map((item) => ({ product_id: item.product_id, merchandise_paise: item.line_total_paise })),
    });
    const productIds = cart.items.map((item) => item.product_id);
    const before = cart.items.reduce((sum, item) => sum + item.line_total_paise, 0);
    if (!judged.applied) {
      void track("notes_discount_rejected", {
        coupon_code: normalized,
        product_ids: productIds,
        error_reason: judged.reason,
        cart_value_before: before,
      });
      return noStoreJson({
        ok: true,
        enabled: true,
        valid: false,
        reason: judged.reason,
        message: judged.reason === "not_applicable"
          ? "This code doesn’t apply to the items in your cart."
          : judged.message || customerDiscountMessage("invalid"),
      });
    }
    await setCartDiscountCode(cart.id, judged.applied.code);
    const summary = publicDiscountSummary(judged.applied);
    void track("notes_discount_applied", {
      coupon_code: summary.code,
      product_ids: summary.eligible_product_ids,
      discount_amount: summary.discount_paise,
      cart_value_before: summary.merchandise_before_paise,
      cart_value_after: summary.merchandise_after_paise,
    });
    return noStoreJson({
      ok: true,
      enabled: true,
      valid: true,
      code: summary.code,
      discount_paise: summary.discount_paise,
      discount_label: formatPaise(summary.discount_paise),
    });
  }

  if (!cart.discount_code) return noStoreJson({ ok: true, enabled: true, valid: false });
  const judged = await judgeCartDiscount({
    rawCode: cart.discount_code,
    lines: cart.items.map((item) => ({ product_id: item.product_id, merchandise_paise: item.line_total_paise })),
  });
  if (!judged.applied) {
    await setCartDiscountCode(cart.id, null);
    return noStoreJson({
      ok: true,
      enabled: true,
      valid: false,
      removed: true,
      message: judged.reason === "not_applicable"
        ? customerDiscountMessage("not_applicable", cart.discount_code)
        : judged.message,
    });
  }
  return noStoreJson({
    ok: true,
    enabled: true,
    valid: true,
    code: judged.applied.code,
    discount_paise: judged.applied.discount_paise,
    discount_label: formatPaise(judged.applied.discount_paise),
  });
}
