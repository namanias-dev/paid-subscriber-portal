import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getOverview } from "@/lib/sms/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const overview = await getOverview();
  return NextResponse.json({ ok: true, overview });
}
