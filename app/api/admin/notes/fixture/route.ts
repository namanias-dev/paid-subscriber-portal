import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { applyLocalFixtureScene, localFixtureEnabled } from "@/lib/store/localFixture";

export const dynamic = "force-dynamic";

/**
 * Move the single local test order between fixture scenes.
 * Absent unless NOTES_STORE_LOCAL_FIXTURE is on and this process is not Vercel.
 * It does not call a courier or a payment gateway.
 */
export async function POST(req: Request) {
  if (!localFixtureEnabled()) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const body = (await req.json().catch(() => null)) as { scene?: string } | null;
  const result = applyLocalFixtureScene(String(body?.scene || ""));
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
