import { NextResponse } from "next/server";
import { requireAdmin, requireAnyPermission, requirePermission, getActionActor } from "@/lib/adminGuard";
import {
  adminRequestReupload,
  adminRejectProof,
  adminAddProofNote,
} from "@/lib/paymentProofs";
import { staffUploadProof, approvePaymentAction, logPaymentAction } from "@/lib/paymentActions";
import { getPaymentById, getPaymentByReference } from "@/lib/dataProvider";
import type { PaymentProofFile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Admin/staff proof actions:
 *   - upload           { paymentId, files[], note? }        ->  staff proof upload (R2)
 *   - accept           { paymentId | referenceNo, note? }   ->  approve (reuses PAID path)
 *   - request_reupload { proofId, reason? }
 *   - reject           { proofId, reason? }
 *   - note             { proofId, note }
 *
 * Read actions allow manage_payments OR view_revenue (finance). WRITE actions that
 * change a payment/grant access (upload, accept) require manage_payments. Every
 * write is attributed to the actor in the immutable payment_action_log.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireAnyPermission(["manage_payments", "view_revenue"]))) {
    return NextResponse.json({ ok: false, error: "Forbidden — payments access required." }, { status: 403 });
  }
  const actor = await getActionActor();
  const adminId = actor?.id || "admin";

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    proofId?: string;
    paymentId?: string;
    referenceNo?: string;
    reason?: string;
    note?: string;
    files?: PaymentProofFile[];
  };

  try {
    switch (body.action) {
      case "upload": {
        if (!(await requirePermission("manage_payments"))) {
          return NextResponse.json({ ok: false, error: "Forbidden — manage_payments required." }, { status: 403 });
        }
        if (!body.paymentId) return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });
        if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const r = await staffUploadProof({
          paymentId: body.paymentId,
          files: body.files || [],
          note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
          actor,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "accept": {
        if (!(await requirePermission("manage_payments"))) {
          return NextResponse.json({ ok: false, error: "Forbidden — manage_payments required." }, { status: 403 });
        }
        if (!body.paymentId && !body.referenceNo) {
          return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });
        }
        if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const r = await approvePaymentAction({
          paymentId: body.paymentId,
          referenceNo: body.referenceNo,
          note: body.note ?? null,
          actor,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "request_reupload": {
        if (!body.proofId) return NextResponse.json({ ok: false, error: "Missing proof." }, { status: 400 });
        const r = await adminRequestReupload(body.proofId, adminId, body.reason ?? null);
        if (r.ok && actor) {
          const pay = body.paymentId ? await getPaymentById(body.paymentId).catch(() => null) : null;
          void logPaymentAction({ action: "reupload_request", payment: pay, actor, reason: body.reason ?? null });
        }
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "reject": {
        if (!body.proofId) return NextResponse.json({ ok: false, error: "Missing proof." }, { status: 400 });
        const r = await adminRejectProof(body.proofId, adminId, body.reason ?? null);
        if (r.ok && actor) {
          const pay = body.paymentId
            ? await getPaymentById(body.paymentId).catch(() => null)
            : body.referenceNo
              ? await getPaymentByReference(body.referenceNo).catch(() => null)
              : null;
          void logPaymentAction({ action: "reject", payment: pay, actor, reason: body.reason ?? null });
        }
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "note": {
        if (!body.proofId || !body.note) return NextResponse.json({ ok: false, error: "Missing note." }, { status: 400 });
        const r = await adminAddProofNote(body.proofId, adminId, body.note);
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
