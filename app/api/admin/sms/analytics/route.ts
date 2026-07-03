import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSmsAnalytics } from "@/lib/sms/queries";
import { getSettings } from "@/lib/sms/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days")) || 30));
  // Default the segment rate to the manually-set cost-per-SMS from Settings; an
  // explicit ?rate= still overrides for ad-hoc what-ifs.
  const rateParam = url.searchParams.get("rate");
  const rate = rateParam != null ? Math.max(0, Number(rateParam) || 0) : ((await getSettings()).costPerSms ?? 0.13);
  const analytics = await getSmsAnalytics(days, rate);
  return NextResponse.json({ ok: true, analytics });
}
