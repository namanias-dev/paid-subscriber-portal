import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getAnalytics, getFullAnalytics } from "@/lib/telegram/analytics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  if (mode === "legacy") {
    const analytics = await getAnalytics();
    return NextResponse.json({ ok: true, ...analytics });
  }
  const full = await getFullAnalytics();
  return NextResponse.json({ ok: true, ...full });
}
