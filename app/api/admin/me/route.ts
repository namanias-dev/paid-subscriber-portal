import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { isDemoMode } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ ok: false, demo: isDemoMode }, { status: 401 });
    return NextResponse.json({ ok: true, admin: session, demo: isDemoMode });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
