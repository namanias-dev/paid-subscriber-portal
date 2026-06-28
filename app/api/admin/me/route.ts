import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { isDemoMode } from "@/lib/config";
import { effectivePermissions } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ ok: false, demo: isDemoMode }, { status: 401 });
    // Return EFFECTIVE permissions (Super Admin gets all, incl. newly added ones)
    // so the client nav matches the server-side guards without a re-login.
    const admin = { ...session, permissions: effectivePermissions(session) };
    return NextResponse.json({ ok: true, admin, demo: isDemoMode });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
