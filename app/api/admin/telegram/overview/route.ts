import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getOverview } from "@/lib/telegram/analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const overview = await getOverview();
  return NextResponse.json({ ok: true, overview });
}
