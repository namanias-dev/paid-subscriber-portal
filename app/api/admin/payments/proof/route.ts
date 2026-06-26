import { NextResponse } from "next/server";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";
import { getAdminSession } from "@/lib/session";
import {
  adminRequestReupload,
  adminRejectProof,
  adminAddProofNote,
  acceptPaymentManually,
} from "@/lib/paymentProofs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Admin proof actions:
 *   - request_reupload { proofId, reason? }
 *   - reject           { proofId, reason? }
 *   - note             { proofId, note }
 *   - accept           { paymentId | referenceNo, note? }  ->  reuses PAID path
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireAnyPermission(["manage_payments", "view_revenue"]))) {
    return NextResponse.json({ ok: false, error: "Forbidden — payments access required." }, { status: 403 });
  }
  const session = await getAdminSession();
  const adminId = session?.username || session?.admin_id || "admin";

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    proofId?: string;
    paymentId?: string;
    referenceNo?: string;
    reason?: string;
    note?: string;
  };

  try {
    switch (body.action) {
      case "request_reupload": {
        if (!body.proofId) return NextResponse.json({ ok: false, error: "Missing proof." }, { status: 400 });
        const r = await adminRequestReupload(body.proofId, adminId, body.reason ?? null);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "reject": {
        if (!body.proofId) return NextResponse.json({ ok: false, error: "Missing proof." }, { status: 400 });
        const r = await adminRejectProof(body.proofId, adminId, body.reason ?? null);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "note": {
        if (!body.proofId || !body.note) return NextResponse.json({ ok: false, error: "Missing note." }, { status: 400 });
        const r = await adminAddProofNote(body.proofId, adminId, body.note);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "accept": {
        if (!body.paymentId && !body.referenceNo) {
          return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });
        }
        const r = await acceptPaymentManually({
          paymentId: body.paymentId,
          referenceNo: body.referenceNo,
          adminId,
          note: body.note ?? null,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    console.error("[admin/payments/proof] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
