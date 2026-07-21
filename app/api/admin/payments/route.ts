import { NextResponse } from "next/server";
import { getPayments, getEnrollments, getBuyers, maybeReconcilePendingPayments, getWebinars, getAllCourses, getLeads } from "@/lib/dataProvider";
import { getAllProofs, phoneHasAccessToItem } from "@/lib/paymentProofs";
import { requireAdmin, requireAnyPermission, requirePermission, requireSuperAdmin } from "@/lib/adminGuard";
import { isPaymentsUiV2Enabled } from "@/lib/marketing/paymentsUiFlag";
import { normPhone } from "@/lib/phone";
import type { PaymentProof } from "@/lib/types";

/** Read-only per-user marketing attribution stamp shown on the Payments card. */
export interface PaymentsLeadAttr {
  channel: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    // Revenue/payments are financial data — gated behind explicit permission.
    if (!(await requireAnyPermission(["view_revenue", "manage_payments"]))) {
      return NextResponse.json({ ok: false, error: "Forbidden — revenue access required." }, { status: 403 });
    }
    // Expire stale pending rows (throttled) so the admin tab never shows a
    // >10-min pending forever, even between scheduled cron sweeps.
    await maybeReconcilePendingPayments();
    const [payments, enrollments, buyers, proofList, webinars, courses, leads] = await Promise.all([
      getPayments(),
      getEnrollments(),
      getBuyers(),
      getAllProofs(),
      getWebinars(),
      getAllCourses(),
      getLeads(),
    ]);
    // phone -> login code, so support can resolve "forgot code" escalations.
    const buyerCodes: Record<string, string> = {};
    for (const b of buyers) buyerCodes[b.phone] = b.login_code;

    // CURRENT item name resolved by reference (item_type + slug) so a webinar/
    // course rename propagates to Payments & Finance automatically (Problem 4).
    // The stored payments.item snapshot is never mutated — this is display-only.
    const itemNames: Record<string, string> = {};
    for (const w of webinars) if (w.slug) itemNames[`webinar:${w.slug}`] = w.title;
    for (const c of courses) if (c.slug) itemNames[`course:${c.slug}`] = c.title;

    // payment_id -> proof, plus a per-proof "already has access" flag so admins
    // don't accept a duplicate/already-paid attempt unnecessarily.
    // Perf: the access check is pure w.r.t. (phone,item_type,item_slug), so resolve
    // it ONCE per distinct target instead of once per proof (avoids repeating the
    // same entitlement lookups when a phone has several proofs for one item).
    const proofs: Record<string, PaymentProof & { hasAccess: boolean }> = {};
    const accessKey = (pr: PaymentProof) => `${pr.phone}|${pr.item_type ?? ""}|${pr.item_slug ?? ""}`;
    const uniqueTargets = new Map<string, { phone: string; item_type: string | null; item_slug: string | null }>();
    for (const pr of proofList) if (!uniqueTargets.has(accessKey(pr))) uniqueTargets.set(accessKey(pr), { phone: pr.phone, item_type: pr.item_type, item_slug: pr.item_slug });
    const accessByKey = new Map<string, boolean>();
    await Promise.all(
      [...uniqueTargets].map(async ([k, t]) => {
        accessByKey.set(k, await phoneHasAccessToItem(t.phone, t.item_type, t.item_slug).catch(() => false));
      }),
    );
    for (const pr of proofList) proofs[pr.payment_id] = { ...pr, hasAccess: accessByKey.get(accessKey(pr)) ?? false };

    // Read-only phone -> marketing attribution stamp, joined from the existing
    // lead record so the Payments user card can surface the lead SOURCE without
    // touching any payment/enrolment data or logic. Phone is normalized (last-10
    // digits) so a "+91..." payment row matches a raw-10-digit lead row and vice
    // versa. First matching lead per normalized phone wins (leads are typically
    // deduped by phone via addLead()'s fold-by-phone anyway).
    const leadAttrByPhone: Record<string, PaymentsLeadAttr> = {};
    for (const l of leads) {
      const key = normPhone(l.phone);
      if (!key || leadAttrByPhone[key]) continue;
      leadAttrByPhone[key] = {
        channel: l.channel ?? null,
        utm_campaign: l.utm_campaign ?? null,
        utm_source: l.utm_source ?? null,
      };
    }

    // UI capability flags: who can take staff write actions (manage_payments) and
    // who can see super-admin-only controls (reverse, accountability, history).
    const [canManage, isSuper] = await Promise.all([requirePermission("manage_payments"), requireSuperAdmin()]);

    // Server-read Payments UI v2 flag (default ON) — kept off the client bundle
    // so `PAYMENTS_UI_V2=false` in Vercel env instantly falls the admin page
    // back to the pre-shipment card + filter layout without a redeploy.
    const paymentsUiV2 = isPaymentsUiV2Enabled();

    return NextResponse.json({ ok: true, payments, enrollments, buyerCodes, proofs, itemNames, leadAttrByPhone, canManage, isSuper, paymentsUiV2 });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load payments." }, { status: 500 });
  }
}
