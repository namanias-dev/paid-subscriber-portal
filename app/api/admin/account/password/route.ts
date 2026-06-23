import { NextResponse } from "next/server";
import { changeOwnPassword, verifyAdminCredentials } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const current = String(body.current_password || "");
    const next = String(body.new_password || "");
    if (next.length < 8) return NextResponse.json({ ok: false, error: "New password must be at least 8 characters." }, { status: 400 });
    // Re-verify the current password before allowing a change.
    const ok = await verifyAdminCredentials(session.username, current);
    if (!ok) return NextResponse.json({ ok: false, error: "Current password is incorrect." }, { status: 400 });
    const result = await changeOwnPassword(session.admin_id, next);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Password change failed." }, { status: 500 });
  }
}
