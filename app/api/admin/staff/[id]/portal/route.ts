import { NextResponse } from "next/server";
import {
  getAdminAccountById,
  getBuyerByPhone,
  ensureStaffPortalAccount,
  regenerateStaffPortalCode,
} from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import { normalizeIndianMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Current portal test-login status for a staff member (phone + login code). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_staff"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const admin = await getAdminAccountById(params.id);
    if (!admin) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!admin.phone) return NextResponse.json({ ok: true, phone: null, loginCode: null, provisioned: false });
    const buyer = await getBuyerByPhone(admin.phone);
    return NextResponse.json({
      ok: true,
      phone: admin.phone,
      loginCode: buyer?.login_code ?? null,
      provisioned: !!buyer,
      isStaffAccount: !!buyer?.is_staff,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load portal login." }, { status: 500 });
  }
}

/** Provision (or regenerate) the staff member's portal test login. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_staff"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const admin = await getAdminAccountById(params.id);
    if (!admin) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const n = normalizeIndianMobile(admin.phone);
    if (!n.ok || !n.digits10) {
      return NextResponse.json({ ok: false, error: "Set a valid 10-digit phone for this staff member first." }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const buyer = body?.regenerate
      ? await regenerateStaffPortalCode(n.digits10, admin.name)
      : await ensureStaffPortalAccount(n.digits10, admin.name);
    if (!buyer) return NextResponse.json({ ok: false, error: "Could not provision the portal login." }, { status: 500 });
    return NextResponse.json({ ok: true, phone: buyer.phone, loginCode: buyer.login_code });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update portal login." }, { status: 500 });
  }
}
