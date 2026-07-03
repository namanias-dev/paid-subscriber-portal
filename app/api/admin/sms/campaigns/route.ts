import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listCampaigns } from "@/lib/sms/store";

export const dynamic = "force-dynamic";

/** Campaign history + delivery analytics (per-campaign sent/delivered/failed + rate). */
export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 50));
  return NextResponse.json({ ok: true, campaigns: await listCampaigns(limit) });
}
