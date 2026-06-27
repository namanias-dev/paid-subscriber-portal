import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSmsAnalytics } from "@/lib/sms/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const rate = Math.max(0, Number(url.searchParams.get("rate")) || 0.2);
  const analytics = await getSmsAnalytics(days, rate);
  return NextResponse.json({ ok: true, analytics });
}
