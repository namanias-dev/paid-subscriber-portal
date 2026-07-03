import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { listOptOuts, addOptOut, removeOptOut } from "@/lib/sms/store";

export const dynamic = "force-dynamic";

/**
 * Opt-out / DND suppression list. Suppressed numbers are skipped on EVERY send
 * path (enforced in the SMS service). An inbound STOP-keyword webhook would POST
 * here with source='sms_stop'; admins manage entries from the Settings tab.
 */
export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, optOuts: await listOptOuts() });
}

export async function POST(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super Admin only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const mobile = typeof body.mobile === "string" ? body.mobile : "";
  if (!mobile.trim()) return NextResponse.json({ ok: false, error: "Missing mobile" }, { status: 400 });
  const ok = await addOptOut(mobile, typeof body.reason === "string" ? body.reason : null, "manual", await currentAdminId());
  if (!ok) return NextResponse.json({ ok: false, error: "Enter a valid 10-digit mobile" }, { status: 400 });
  return NextResponse.json({ ok: true, optOuts: await listOptOuts() });
}

export async function DELETE(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super Admin only" }, { status: 403 });
  const mobile = new URL(req.url).searchParams.get("mobile") || "";
  if (!mobile) return NextResponse.json({ ok: false, error: "Missing mobile" }, { status: 400 });
  await removeOptOut(mobile);
  return NextResponse.json({ ok: true, optOuts: await listOptOuts() });
}
