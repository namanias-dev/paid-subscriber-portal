import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/adminGuard";
import { getDeletedPayments } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Recoverable Trash — soft-deleted payments. SUPER ADMIN ONLY. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  try {
    const payments = await getDeletedPayments();
    return NextResponse.json({ ok: true, payments });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
