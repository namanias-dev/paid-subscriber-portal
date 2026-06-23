import { NextResponse } from "next/server";
import { resetAdminPassword } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_staff"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const result = await resetAdminPassword(params.id, typeof body.password === "string" && body.password ? body.password : undefined);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, password: result.password });
  } catch {
    return NextResponse.json({ ok: false, error: "Password reset failed." }, { status: 500 });
  }
}
