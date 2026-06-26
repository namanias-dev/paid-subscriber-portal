import { NextResponse } from "next/server";
import { getPayments, getEnrollments, getBuyers, maybeReconcilePendingPayments } from "@/lib/dataProvider";
import { getAllProofs, phoneHasAccessToItem } from "@/lib/paymentProofs";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";
import type { PaymentProof } from "@/lib/types";

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
    const [payments, enrollments, buyers, proofList] = await Promise.all([
      getPayments(),
      getEnrollments(),
      getBuyers(),
      getAllProofs(),
    ]);
    // phone -> login code, so support can resolve "forgot code" escalations.
    const buyerCodes: Record<string, string> = {};
    for (const b of buyers) buyerCodes[b.phone] = b.login_code;

    // payment_id -> proof, plus a per-proof "already has access" flag so admins
    // don't accept a duplicate/already-paid attempt unnecessarily.
    const proofs: Record<string, PaymentProof & { hasAccess: boolean }> = {};
    await Promise.all(
      proofList.map(async (pr) => {
        const hasAccess = await phoneHasAccessToItem(pr.phone, pr.item_type, pr.item_slug).catch(() => false);
        proofs[pr.payment_id] = { ...pr, hasAccess };
      }),
    );

    return NextResponse.json({ ok: true, payments, enrollments, buyerCodes, proofs });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load payments." }, { status: 500 });
  }
}
