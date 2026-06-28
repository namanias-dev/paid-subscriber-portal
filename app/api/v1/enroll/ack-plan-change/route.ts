import { NextResponse } from "next/server";
import { getBuyerSession } from "@/lib/session";
import { acknowledgePlanChangeNotice } from "@/lib/dataProvider";

/** Student acknowledges the "your payment plan changed" notice (phone-scoped). */
export async function POST(req: Request) {
  try {
    const session = await getBuyerSession();
    if (!session?.phone) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const enrollmentId = String(body.enrollmentId || "");
    if (!enrollmentId) return NextResponse.json({ ok: false, error: "Missing enrollment." }, { status: 400 });
    const ok = await acknowledgePlanChangeNotice(enrollmentId, session.phone);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to acknowledge." }, { status: 500 });
  }
}
