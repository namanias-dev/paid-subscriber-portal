/**
 * ADMIN AGENT API — security / privacy audit log viewer.
 * API-enforced auth: requirePermission('manage_ai_agent').
 *
 * Reads ai_security_audit (append-only). Rows are already redacted at write time,
 * so this viewer never surfaces raw PII.
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, logs: [], demo: true });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 500);

  try {
    let q = db.from("ai_security_audit").select("*").order("created_at", { ascending: false }).limit(limit);
    if (action) q = q.eq("action", action);
    const { data } = await q;
    return NextResponse.json({ ok: true, logs: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load audit log." }, { status: 500 });
  }
}
