import { NextResponse } from "next/server";
import { getCourseBySlug, getWebinarBySlug, createPayment, getPaymentByReference } from "@/lib/dataProvider";
import { getPlan } from "@/lib/config";
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
}

async function resolveItem(itemType: ItemType, body: Record<string, unknown>): Promise<ResolvedItem | null> {
  if (itemType === "course") {
    const slug = String(body.courseSlug || body.slug || "");
    const course = await getCourseBySlug(slug);
    if (!course) return null;
    return { item: course.title, itemSlug: course.slug, amount: course.price };
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
    return { item: webinar.title, itemSlug: webinar.slug, amount: webinar.price };
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
    // Email is mandatory for the Eazypay mandatory-fields payload.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
    }

    const resolved = await resolveItem(itemType, body);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
    }

    // Amount is computed server-side; any client-supplied amount is ignored.
    const amount = Number(resolved.amount) || 0;

    // Free items short-circuit: no gateway, immediately marked PAID.
    if (amount <= 0) {
      const referenceNo = await uniqueReference(itemType);
      await createPayment({
        student_name: name,
        phone: mobile,
        email,
        item: resolved.item,
        item_type: itemType,
        item_slug: resolved.itemSlug,
        amount: 0,
        status: "PAID",
        gateway: PAYMENT_GATEWAY,
        reference_no: referenceNo,
        razorpay_payment_id: null,
        mode: null,
      });
      return NextResponse.json({
        ok: true,
        free: true,
        referenceNo,
        paymentUrl: `/payment/status?ref=${encodeURIComponent(referenceNo)}`,
      });
    }

    const referenceNo = await uniqueReference(itemType);
    const subMerchantId = eazypaySubMerchantId(itemType, resolved.itemSlug);

    await createPayment({
      student_name: name,
      phone: mobile,
      email,
      item: resolved.item,
      item_type: itemType,
      item_slug: resolved.itemSlug,
      amount,
      status: "PENDING",
      gateway: PAYMENT_GATEWAY,
      reference_no: referenceNo,
      sub_merchant_id: subMerchantId,
      transaction_amount: amount,
      razorpay_payment_id: null,
      mode: null,
    });

    if (isEazypayConfigured()) {
      const paymentUrl = buildPaymentUrl({
        referenceNo,
        subMerchantId,
        amount,
        name,
        email,
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
