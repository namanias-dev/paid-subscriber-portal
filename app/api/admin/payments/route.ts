import { NextResponse } from "next/server";
import { getPayments, getEnrollments, getBuyers, maybeReconcilePendingPayments, getWebinars, getAllCourses, getLeadsForPillMap } from "@/lib/dataProvider";
import { getAllProofs, buildProofAccessSnapshot, phoneHasAccessToItemSync } from "@/lib/paymentProofs";
import { requireAdmin, requireAnyPermission, requirePermission, requireSuperAdmin } from "@/lib/adminGuard";
import { isPaymentsUiV2Enabled } from "@/lib/marketing/paymentsUiFlag";
import { buildLeadAttrByPhone, pruneEmptyChannels } from "@/lib/marketing/leadAttrByPhone";
import { lookupLegacyLeadsByPhones } from "@/lib/marketing/legacyLeadMatch";
import type { PaymentProof } from "@/lib/types";

/**
 * Read-only per-user marketing attribution stamp shown on the Payments card.
 *
 * `legacy` is set when the underlying lead is a legacy-imported row. The
 * `SourcePill` still renders `channel` when it's populated (real capture that
 * PREDATED the legacy backfill is always shown honestly), but the source-card
 * aggregate counts route through {@link @/lib/webinarSource.derivedChannelFor}
 * which drops legacy rows to "Unknown" — so the totals stay byte-identical to
 * the pre-shipment legacy-free numbers (G1 in
 * docs/naman-ai/reports/payment-source-restore.md).
 *
 * `displayChannel` (2026-07-24 widen) is the best-effort channel derived
 * server-side from the fullest available lead signal (scalar `channel` first,
 * then `attribution.first_touch`, then utm/form-source fallback via
 * `deriveChannel`). SourcePill renders `displayChannel || channel`. Aggregate
 * counts continue reading `channel` only, so totals stay unchanged.
 */
export interface PaymentsLeadAttr {
  channel: string | null;
  displayChannel: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
  legacy?: boolean;
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
      // Only the ~1.3k rows that can contribute to SourcePill display are read
      // — the ENTIRE 179k lead table would blow the serverless response-body
      // budget and time out the client. See {@link getLeadsForPillMap} for the
      // full contract (non-legacy universe + legacy-with-channel slice; the
      // collision-preference G2 rule is preserved because non-legacy leads are
      // fetched in full even when their scalar channel is null).
      getLeadsForPillMap(),
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
    const snap = await buildProofAccessSnapshot({
      payments,
      webinars,
      courses,
      proofPhones: proofList.map((pr) => pr.phone),
    });
    for (const pr of proofList) {
      proofs[pr.payment_id] = {
        ...pr,
        hasAccess: phoneHasAccessToItemSync(pr.phone, pr.item_type, pr.item_slug, snap),
      };
    }

    // Read-only phone -> marketing attribution stamp, joined from the existing
    // lead record so the Payments user card can surface the lead SOURCE without
    // touching any payment/enrolment data or logic. Phone is normalized (last-10
    // digits) so a "+91..." payment row matches a raw-10-digit lead row and vice
    // versa. See {@link buildLeadAttrByPhone} for the full preference contract
    // (non-legacy wins on collision — G2 in the payment-source-restore report).
    //
    // The map is PRUNED to channel-carrying entries before serialization. Both
    // consumers (`SourcePill` and `derivedChannelFor`) treat a missing-phone
    // entry and a null-channel entry identically, so the prune is behaviorally
    // a no-op but shrinks the JSON payload by ~90% (the scale-regression fix
    // documented in docs/naman-ai/reports/payment-pill-deploystate-fix.md).
    const leadAttrByPhone: Record<string, PaymentsLeadAttr> = pruneEmptyChannels(
      buildLeadAttrByPhone(leads),
    );

    // Additive historical match — CURRENT payment phones only (set-based).
    // Never mutates source/status; never runs on the payment write path.
    const legacyLeadByPhone = await lookupLegacyLeadsByPhones(payments.map((p) => p.phone));

    // UI capability flags: who can take staff write actions (manage_payments) and
    // who can see super-admin-only controls (reverse, accountability, history).
    const [canManage, isSuper] = await Promise.all([requirePermission("manage_payments"), requireSuperAdmin()]);

    // Server-read Payments UI v2 flag (default ON) — kept off the client bundle
    // so `PAYMENTS_UI_V2=false` in Vercel env instantly falls the admin page
    // back to the pre-shipment card + filter layout without a redeploy.
    const paymentsUiV2 = isPaymentsUiV2Enabled();

    // Slim webinar catalogue for the collapsed "Registrations by webinar" card
    // (pick chronologically latest). Display-only — no payment logic depends on it.
    const webinarMeta = webinars.map((w) => ({
      slug: w.slug,
      title: w.title,
      datetime: w.datetime,
    }));

    return NextResponse.json({ ok: true, payments, enrollments, buyerCodes, proofs, itemNames, leadAttrByPhone, legacyLeadByPhone, canManage, isSuper, paymentsUiV2, webinarMeta });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load payments." }, { status: 500 });
  }
}
