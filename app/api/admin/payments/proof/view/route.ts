import { NextResponse } from "next/server";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";
import { r2Configured, signGetUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Mint a short-lived signed GET for one proof file. Screenshots contain
 * personal/bank info — they are NEVER public. Admin-only; key is scoped to the
 * payment-proofs prefix to prevent reading arbitrary objects.
 */
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireAnyPermission(["manage_payments", "view_revenue"]))) {
    return NextResponse.json({ ok: false, error: "Forbidden — payments access required." }, { status: 403 });
  }
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Storage unavailable." }, { status: 503 });

  const key = new URL(req.url).searchParams.get("key") || "";
  if (!key.startsWith("payment-proofs/")) {
    return NextResponse.json({ ok: false, error: "Invalid key." }, { status: 400 });
  }
  try {
    const url = await signGetUrl(key, 300); // 5-minute viewing window
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    console.error("[admin/payments/proof/view] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Could not open the file." }, { status: 500 });
  }
}
