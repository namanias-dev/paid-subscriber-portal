import { NextResponse } from "next/server";
import { isDemoMode, getPlan, PLANS } from "@/lib/config";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  findStudentByPhone,
  addStudent,
  updateStudent,
  logAccess,
} from "@/lib/dataProvider";
import { sendAccessCodeEmail } from "@/lib/email";
import { formatDate } from "@/lib/dates";
import type { PlanId } from "@/lib/types";

const DAY = 86400000;

function planFromAmount(amountRupees: number): PlanId {
  const match = PLANS.find((p) => p.price === amountRupees);
  return (match?.id as PlanId) || "1m";
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    if (isDemoMode) {
      return NextResponse.json({ ok: true, demo: true });
    }

    if (!verifyRazorpaySignature(rawBody, signature)) {
      return NextResponse.json(
        { ok: false, error: "Invalid signature" },
        { status: 400 }
      );
    }

    const event = JSON.parse(rawBody);
    if (event?.event !== "payment.captured") {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const payment = event?.payload?.payment?.entity ?? {};
    const paymentId: string = payment.id;
    const orderId: string = payment.order_id;
    const amountRupees = Math.round((payment.amount ?? 0) / 100);
    const notes = payment.notes ?? {};
    const phone = String(notes.phone || payment.contact || "").replace(/\D/g, "").slice(-10);
    const name = String(notes.name || "UPSC Aspirant");
    const email = notes.email ? String(notes.email) : null;
    const planId = (notes.plan as PlanId) || planFromAmount(amountRupees);
    const plan = getPlan(planId);
    const months = plan?.months ?? null;

    const db = getSupabaseAdmin();

    // Idempotency: skip if this payment_id already processed
    if (db && paymentId) {
      const { data: existing } = await db
        .from("students")
        .select("id")
        .eq("razorpay_payment_id", paymentId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ ok: true, idempotent: true });
      }
    }

    const existingStudent = phone ? await findStudentByPhone(phone) : null;

    if (existingStudent) {
      // Renewal: extend expiry, accumulate amount
      const base =
        existingStudent.expiry_date &&
        new Date(existingStudent.expiry_date).getTime() > Date.now()
          ? new Date(existingStudent.expiry_date).getTime()
          : Date.now();
      const newExpiry =
        months == null ? null : new Date(base + months * 30 * DAY).toISOString();
      const updated = await updateStudent(existingStudent.id, {
        expiry_date: newExpiry,
        plan: planId,
        months,
        amount_paid: (existingStudent.amount_paid ?? 0) + amountRupees,
        razorpay_payment_id: paymentId,
        razorpay_order_id: orderId,
        is_active: true,
      });
      await logAccess(existingStudent.id, `renewal:${paymentId}`);
      if (updated?.email) {
        await sendAccessCodeEmail({
          to: updated.email,
          name: updated.name,
          code: updated.access_code,
          planName: plan?.name || planId,
          expiry: formatDate(updated.expiry_date),
        });
      }
      return NextResponse.json({ ok: true, renewal: true });
    }

    // New student
    const created = await addStudent({
      name,
      phone: phone || `unknown-${Date.now()}`,
      email,
      plan: planId,
      months,
      amount_paid: amountRupees,
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
    });
    await logAccess(created.id, `new:${paymentId}`);
    if (created.email) {
      await sendAccessCodeEmail({
        to: created.email,
        name: created.name,
        code: created.access_code,
        planName: plan?.name || planId,
        expiry: formatDate(created.expiry_date),
      });
    }
    return NextResponse.json({ ok: true, created: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Webhook processing error" },
      { status: 500 }
    );
  }
}
