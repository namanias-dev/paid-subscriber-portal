import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getJourney } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const phone = new URL(req.url).searchParams.get("phone") || "";
    if (!phone) return NextResponse.json({ ok: false, error: "Missing phone." }, { status: 400 });
    const journey = await getJourney(phone);
    return NextResponse.json({ ok: true, journey });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load journey." }, { status: 500 });
  }
}
