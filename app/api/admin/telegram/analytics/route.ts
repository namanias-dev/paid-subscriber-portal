import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getAnalytics } from "@/lib/telegram/analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const analytics = await getAnalytics();
  return NextResponse.json({ ok: true, ...analytics });
}
