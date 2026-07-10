/**
 * ADMIN AGENT API — overview counts/summary.
 * API-enforced auth: requirePermission('manage_ai_agent') (super-admin inherits).
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, overview: null, demo: true });

  try {
    const head = { count: "exact" as const, head: true };
    const [total, cold, warm, hot, conversations, followupsPending] = await Promise.all([
      db.from("ai_leads").select("id", head),
      db.from("ai_leads").select("id", head).eq("temperature", "cold"),
      db.from("ai_leads").select("id", head).eq("temperature", "warm"),
      db.from("ai_leads").select("id", head).eq("temperature", "hot"),
      db.from("ai_conversations").select("id", head),
      db.from("ai_followups").select("id", head).eq("status", "pending"),
    ]);

    return NextResponse.json({
      ok: true,
      overview: {
        leads: {
          total: total.count ?? 0,
          cold: cold.count ?? 0,
          warm: warm.count ?? 0,
          hot: hot.count ?? 0,
        },
        conversations: conversations.count ?? 0,
        followups: { pending: followupsPending.count ?? 0 },
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load overview." }, { status: 500 });
  }
}
