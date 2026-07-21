import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getCourseBySlug,
  getWebinarBySlug,
  getWebinarById,
  createPayment,
  getPaymentByReference,
  incrementCouponUsage,
  findRecentOpenPaymentForItem,
  logWebinarAudit,
} from "@/lib/dataProvider";
import { canRegisterForWebinar, buildClosedError } from "@/lib/webinarLifecycle";
import { ATTR_COOKIE, parseAttrCookie, flattenForStamp } from "@/lib/attribution";
import { adCaptureStampFromState, EMPTY_AD_CAPTURE_STAMP } from "@/lib/marketing/adCaptureStamp";
import { isFullCaptureEnabled } from "@/lib/marketing/adCaptureFlag";
import { stampBuyerAttribution } from "@/lib/analytics/server";
import { getPlan } from "@/lib/config";
import { validateCoupon } from "@/lib/coupons";
import type { Coupon } from "@/lib/types";
import {
  isEazypayConfigured,
  buildPaymentUrl,
  makeReferenceNo,
  eazypaySubMerchantId,
  PAYMENT_GATEWAY,
} from "@/lib/eazypay";

export const dynamic = "force-dynamic";

type ItemType = "course" | "plan" | "webinar";

interface ResolvedItem {
  item: string;
  itemSlug: string;
  amount: number;
  coupons?: Coupon[];
  entityId?: string;
  couponEntity?: "course" | "webinar";
}

async function resolveItem(itemType: ItemType, body: Record<string, unknown>): Promise<ResolvedItem | null> {
  if (itemType === "course") {
    const slug = String(body.courseSlug || body.slug || "");
    const course = await getCourseBySlug(slug);
    if (!course) return null;
    // Disabled / unpublished courses are not purchasable.
    if (course.status !== "published" || course.active === false) return null;
    return { item: course.title, itemSlug: course.slug, amount: course.price, coupons: course.coupons, entityId: course.id, couponEntity: "course" };
  }
  if (itemType === "plan") {
    const planId = String(body.planId || body.plan || "");
    const plan = getPlan(planId);
    if (!plan) return null;
    return { item: `${plan.name} Subscription`, itemSlug: plan.id, amount: plan.price };
  }
  if (itemType === "webinar") {
    const slug = String(body.webinarSlug || body.slug || body.webinarId || "");
    const webinar = await getWebinarBySlug(slug);
    if (!webinar) return null;
    if (webinar.active === false) return null;
    return { item: webinar.title, itemSlug: webinar.slug, amount: webinar.price, coupons: webinar.coupons, entityId: webinar.id, couponEntity: "webinar" };
  }
  return null;
}

/** Generate a reference number that isn't already present in the store. */
async function uniqueReference(code: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const ref = makeReferenceNo(code);
    const existing = await getPaymentByReference(ref);
    if (!existing) return ref;
  }
  return makeReferenceNo(code);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const itemType = String(body.itemType || "") as ItemType;
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const mobile = String(body.mobile || body.phone || "").replace(/\D/g, "");

    if (!["course", "plan", "webinar"].includes(itemType)) {
      return NextResponse.json({ ok: false, error: "Invalid item type." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ ok: false, error: "Please enter your full name." }, { status: 400 });
    }
    if (mobile.length !== 10) {
      return NextResponse.json({ ok: false, error: "Enter a valid 10-digit mobile number." }, { status: 400 });
    }
    // Email is OPTIONAL. If provided it must be well-formed; if blank we still need
    // a syntactically valid value for Eazypay's mandatory-fields payload, so we
    // derive a non-deliverable placeholder from the phone (real email stored as null).
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address, or leave it blank." }, { status: 400 });
    }
    const gatewayEmail = email || `${mobile}@guest.namanias.com`;

    const resolved = await resolveItem(itemType, body);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
    }

    // FEATURE 6 — server is the source of truth: never initiate a payment for a
    // webinar whose registration has closed/ended (auto-close or manual).
    if (itemType === "webinar") {
      const webinar = await getWebinarBySlug(resolved.itemSlug);
      if (webinar && !canRegisterForWebinar(webinar)) {
        let nextSlug: string | null = null;
        if (webinar.next_webinar_id) {
          const next = await getWebinarById(webinar.next_webinar_id);
          nextSlug = next?.slug ?? null;
        }
        await logWebinarAudit({
          action: "payment_blocked_expired",
          webinar_id: webinar.id,
          actor: "system",
          detail: { phone: mobile, slug: resolved.itemSlug },
        });
        return NextResponse.json(buildClosedError(webinar, nextSlug), { status: 409 });
      }
    }

    // Attribution snapshot from the first-party cookie (best-effort; never blocks).
    const attr = parseAttrCookie(cookies().get(ATTR_COOKIE)?.value);
    const attrFlat = flattenForStamp(attr);
    // Full ad-hierarchy stamp (feature-flagged, default ON). When the flag is
    // off, spread EMPTY_AD_CAPTURE_STAMP so both createPayment calls below are
    // byte-identical to pre-shipment (all NULLs for the new columns).
    const adStamp = isFullCaptureEnabled()
      ? adCaptureStampFromState(attr)
      : EMPTY_AD_CAPTURE_STAMP;

    // Amount is computed server-side; any client-supplied amount is ignored.
    const baseAmount = Number(resolved.amount) || 0;
    let amount = baseAmount;
    let appliedCoupon: string | null = null;

    // Optional coupon — re-validated server-side so a tampered client can't fake a discount.
    const couponCode = String(body.couponCode || body.coupon || "").trim();
    if (couponCode && baseAmount > 0 && resolved.couponEntity) {
      const result = validateCoupon(resolved.coupons, couponCode, baseAmount);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      amount = result.finalAmount;
      appliedCoupon = result.coupon.code;
    }

    // Free items short-circuit: no gateway, immediately marked PAID.
    if (amount <= 0) {
      const referenceNo = await uniqueReference(itemType);
      await createPayment({
        student_name: name,
        phone: mobile,
        email: email || null,
        item: resolved.item,
        item_type: itemType,
        item_slug: resolved.itemSlug,
        amount: 0,
        status: "PAID",
        gateway: PAYMENT_GATEWAY,
        reference_no: referenceNo,
        razorpay_payment_id: null,
        mode: null,
        attribution_source: attrFlat.source,
        attribution_campaign: attrFlat.campaign,
        ...adStamp,
      });
      void stampBuyerAttribution(mobile, attr).catch(() => {});
      if (appliedCoupon && resolved.entityId && resolved.couponEntity) {
        await incrementCouponUsage(resolved.couponEntity, resolved.entityId, appliedCoupon);
      }
      return NextResponse.json({
        ok: true,
        free: true,
        referenceNo,
        paymentUrl: `/payment/status?ref=${encodeURIComponent(referenceNo)}`,
      });
    }

    const subMerchantId = eazypaySubMerchantId(itemType, resolved.itemSlug);

    // Idempotency dedupe: a double-click / refresh within 2 min re-uses the SAME
    // open attempt instead of minting a duplicate PENDING/VERIFYING row.
    const recent = await findRecentOpenPaymentForItem(mobile, itemType, resolved.itemSlug, 120000);
    if (recent && recent.reference_no && Math.round(recent.amount) === Math.round(amount)) {
      if (isEazypayConfigured()) {
        const url = buildPaymentUrl({ referenceNo: recent.reference_no, subMerchantId, amount, name, email: gatewayEmail, mobile });
        if (url) return NextResponse.json({ ok: true, referenceNo: recent.reference_no, paymentUrl: url, reused: true });
      } else {
        return NextResponse.json({ ok: true, demo: true, referenceNo: recent.reference_no, paymentUrl: `/payment/status?ref=${encodeURIComponent(recent.reference_no)}&demo=1`, reused: true });
      }
    }

    const referenceNo = await uniqueReference(itemType);

    await createPayment({
      student_name: name,
      phone: mobile,
      email: email || null,
      item: resolved.item,
      item_type: itemType,
      item_slug: resolved.itemSlug,
      amount,
      // Checkout opened — a click, not money in flight (see enroll/create-payment).
      status: "INITIATED",
      gateway: PAYMENT_GATEWAY,
      reference_no: referenceNo,
      sub_merchant_id: subMerchantId,
      transaction_amount: amount,
      razorpay_payment_id: null,
      mode: null,
      attribution_source: attrFlat.source,
      attribution_campaign: attrFlat.campaign,
      ...adStamp,
    });
    void stampBuyerAttribution(mobile, attr).catch(() => {});

    if (appliedCoupon && resolved.entityId && resolved.couponEntity) {
      await incrementCouponUsage(resolved.couponEntity, resolved.entityId, appliedCoupon);
    }

    if (isEazypayConfigured()) {
      const paymentUrl = buildPaymentUrl({
        referenceNo,
        subMerchantId,
        amount,
        name,
        email: gatewayEmail,
        mobile,
      });
      if (!paymentUrl) {
        return NextResponse.json({ ok: false, error: "Payment gateway unavailable." }, { status: 502 });
      }
      return NextResponse.json({ ok: true, referenceNo, paymentUrl });
    }

    // DEMO MODE: no AES key configured — simulate by routing to the status page.
    return NextResponse.json({
      ok: true,
      demo: true,
      referenceNo,
      paymentUrl: `/payment/status?ref=${encodeURIComponent(referenceNo)}&demo=1`,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not start payment." }, { status: 500 });
  }
}
