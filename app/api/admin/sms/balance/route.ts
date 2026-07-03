import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { checkBalance } from "@/lib/sms/gateway";
import { gatewayConfigured, SMS_DEFAULT_ROUTE } from "@/lib/sms/config";

export const dynamic = "force-dynamic";

/** Remaining SMS credits (route-scoped). Never returns credentials. */
export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!gatewayConfigured()) return NextResponse.json({ ok: true, configured: false, balance: null });
  const routeId = new URL(req.url).searchParams.get("route") || SMS_DEFAULT_ROUTE;
  const bal = await checkBalance(routeId);
  return NextResponse.json({ ok: bal.ok, configured: true, balance: bal.balance, route: routeId, error: bal.ok ? undefined : (bal.error || "balance_unavailable") });
}
